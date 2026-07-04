package com.lyhn.wraith.gateway.qq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * QQ official-bot WebSocket gateway client.
 *
 * <h3>Pure logic (Part A — unit-tested)</h3>
 * {@link #identifyPayload}, {@link #resumePayload}, {@link #heartbeatPayload},
 * {@link #backoffSeconds}, {@link #isFatalQuickDisconnect}, {@link #INTENTS_C2C_AND_INTERACTION}.
 *
 * <h3>Socket shell (Part B — eye-verify + Task 13 mock-WS)</h3>
 * {@link #connect} opens an OkHttp WebSocket, identifies, heartbeats, dispatches
 * inbound events, and reconnects with backoff.
 * The frame-parse-and-dispatch seam lives in the package-visible
 * {@link #handleFrame} method so Task 13 can drive dispatch without a real socket.
 */
public final class QqWsClient {

    private static final Logger log = LoggerFactory.getLogger(QqWsClient.class);
    private static final ObjectMapper M = new ObjectMapper();

    // --- Part A: pure logic ------------------------------------------------

    /** Intents: C2C_MESSAGE_CREATE (bit 25) + INTERACTION_CREATE (bit 26). */
    public static final int INTENTS_C2C_AND_INTERACTION = (1 << 25) | (1 << 26);

    private static final long[] BACKOFF = {2, 5, 10, 30, 60};

    public static String identifyPayload(String token, int intents) {
        return "{\"op\":2,\"d\":{\"token\":\"" + token + "\",\"intents\":" + intents
                + ",\"shard\":[0,1],\"properties\":{}}}";
    }

    public static String resumePayload(String token, String sid, long seq) {
        return "{\"op\":6,\"d\":{\"token\":\"" + token + "\",\"session_id\":\"" + sid
                + "\",\"seq\":" + seq + "}}";
    }

    public static String heartbeatPayload(Long seq) {
        return "{\"op\":1,\"d\":" + (seq == null ? "null" : seq) + "}";
    }

    public static long backoffSeconds(int attempt) {
        return BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
    }

    /**
     * Returns {@code true} when there are ≥3 recent close codes AND all are 4004
     * (WS 认证失败) — i.e. a persistent bad-credential loop where retrying is futile.
     *
     * <p>网络断连(close code {@code -1} / 正常关闭)永远不触发本判定，所以守护进程
     * 会穿过网络抖动持续重连，只在凭证被真正拒绝(连续 4004)时才放弃。
     */
    public static boolean isFatalAuthLoop(int[] recentCloseCodes) {
        if (recentCloseCodes.length < 3) return false;
        for (int c : recentCloseCodes) if (c != 4004) return false;
        return true;
    }

    // --- Part B: socket shell ----------------------------------------------

    private static final String QQ_WS_URL = "wss://api.sgroup.qq.com/websocket/";

    private final QqApiClient api;
    private final OkHttpClient http;

    // Session state — guarded by 'this' lock
    private volatile String sessionId;
    private final AtomicLong lastSeq = new AtomicLong(0);

    private final ScheduledExecutorService heartbeatScheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "qq-heartbeat");
                t.setDaemon(true);
                return t;
            });

    public QqWsClient(QqApiClient api, OkHttpClient http) {
        this.api = api;
        this.http = http;
    }

    /**
     * Opens the QQ gateway WebSocket, identifies, heartbeats, and dispatches
     * {@code C2C_MESSAGE_CREATE} and {@code INTERACTION_CREATE} events until
     * the connection is declared fatal (3+ quick reconnects, all &lt;5 s).
     *
     * <p>This method blocks the calling thread (reconnect loop). Run it on a
     * dedicated thread / virtual thread.
     */
    public void connect(Consumer<InboundMsg> onC2C,
                        Consumer<QqEvents.Interaction> onInteraction) {
        int attempt = 0;
        Deque<Integer> recentCloseCodes = new ArrayDeque<>(4);

        while (!Thread.currentThread().isInterrupted()) {
            long connectStart = System.currentTimeMillis();

            Request req = new Request.Builder().url(QQ_WS_URL).build();
            WsListener listener = new WsListener(onC2C, onInteraction);
            WebSocket ws = http.newWebSocket(req, listener);

            // Wait for the listener to signal close/failure
            try {
                listener.awaitClose();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                ws.cancel();
                return;
            }

            long duration = System.currentTimeMillis() - connectStart;
            int closeCode = listener.closeCode();
            if (recentCloseCodes.size() >= 3) recentCloseCodes.poll();
            recentCloseCodes.addLast(closeCode);

            // 仅「连续 3 次 4004 认证失败」才放弃 —— 坏凭证重试无用。
            // 网络断连(closeCode=-1)不计入：会恢复，绝不因断网退出守护进程。
            int[] codes = recentCloseCodes.stream().mapToInt(Integer::intValue).toArray();
            if (isFatalAuthLoop(codes)) {
                log.error("QqWsClient: 连续 3 次 4004 认证失败 — 凭证可能失效，放弃。请检查 gateway.qq.clientSecret。");
                return;
            }

            // 健康连接(时长≥60s)后重置 backoff，避免长跑中偶发断连的重连延迟越攒越大(#4)。
            if (duration >= 60_000) attempt = 0;

            long backoff = backoffSeconds(attempt++);
            log.warn("QqWsClient: disconnected after {}ms (code={}), reconnecting in {}s (attempt {})",
                    duration, closeCode, backoff, attempt);
            try {
                TimeUnit.SECONDS.sleep(backoff);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    // --- Package-visible frame seam for Task 13 ----------------------------

    /**
     * Parses and dispatches a single raw WS text frame.
     * Package-visible so Task 13 can call it without a real socket.
     *
     * @param text           raw WS text frame
     * @param ws             live WebSocket (used to send heartbeat / identify)
     * @param onC2C          handler for C2C_MESSAGE_CREATE
     * @param onInteraction  handler for INTERACTION_CREATE
     * @param heartbeatMs    mutable holder; set when op 10 is received so the
     *                       caller can schedule heartbeats ({@code long[1]})
     */
    void handleFrame(String text,
                     WebSocket ws,
                     Consumer<InboundMsg> onC2C,
                     Consumer<QqEvents.Interaction> onInteraction,
                     long[] heartbeatMs) {
        try {
            JsonNode root = M.readTree(text);
            int op = root.path("op").asInt(-1);

            // Track sequence number (present on op 0 dispatches)
            JsonNode sNode = root.path("s");
            if (!sNode.isMissingNode() && !sNode.isNull()) {
                lastSeq.set(sNode.asLong());
            }

            switch (op) {
                case 10 -> { // Hello — start identify + heartbeat
                    long interval = root.path("d").path("heartbeat_interval").asLong(30_000);
                    heartbeatMs[0] = interval;
                    log.debug("QqWsClient: Hello, heartbeat_interval={}ms", interval);

                    String token;
                    try {
                        token = api.ensureToken();
                    } catch (IOException e) {
                        log.error("QqWsClient: failed to obtain token for identify", e);
                        ws.cancel();
                        return;
                    }

                    String payload;
                    String sid = sessionId;
                    long seq = lastSeq.get();
                    if (sid != null && seq > 0) {
                        payload = resumePayload("QQBot " + token, sid, seq);
                        log.debug("QqWsClient: sending Resume (sid={}, seq={})", sid, seq);
                    } else {
                        payload = identifyPayload("QQBot " + token, INTENTS_C2C_AND_INTERACTION);
                        log.debug("QqWsClient: sending Identify");
                    }
                    ws.send(payload);
                }
                case 0 -> { // Dispatch
                    String t = root.path("t").asText("");
                    JsonNode d = root.path("d");

                    // Capture session_id on READY
                    if ("READY".equals(t)) {
                        String sid = d.path("session_id").asText(null);
                        if (sid != null && !sid.isEmpty()) {
                            sessionId = sid;
                            log.debug("QqWsClient: READY, session_id={}", sid);
                        }
                    } else if ("C2C_MESSAGE_CREATE".equals(t)) {
                        try {
                            onC2C.accept(QqEvents.parseC2C(d));
                        } catch (Exception e) {
                            log.warn("QqWsClient: C2C dispatch error", e);
                        }
                    } else if ("INTERACTION_CREATE".equals(t)) {
                        try {
                            onInteraction.accept(QqEvents.parseInteraction(d));
                        } catch (Exception e) {
                            log.warn("QqWsClient: Interaction dispatch error", e);
                        }
                    }
                    // All other event types: ignore
                }
                case 1 -> { // Heartbeat request — send immediately
                    ws.send(heartbeatPayload(lastSeq.get() == 0 ? null : lastSeq.get()));
                }
                case 11 -> { // Heartbeat ACK — no-op
                    log.trace("QqWsClient: heartbeat ACK");
                }
                case 7 -> { // Reconnect
                    log.info("QqWsClient: server requested reconnect (op 7)");
                    ws.close(1000, "server reconnect");
                }
                case 9 -> { // Invalid session
                    log.warn("QqWsClient: invalid session (op 9), clearing session state");
                    sessionId = null;
                    lastSeq.set(0);
                    ws.close(1000, "invalid session");
                }
                default -> log.trace("QqWsClient: unhandled op={}", op);
            }
        } catch (Exception e) {
            log.error("QqWsClient: frame parse error", e);
        }
    }

    // --- WsListener inner class --------------------------------------------

    private final class WsListener extends WebSocketListener {
        private final Consumer<InboundMsg> onC2C;
        private final Consumer<QqEvents.Interaction> onInteraction;

        /** Latch-like object; closed when WS terminates. */
        private final java.util.concurrent.CountDownLatch closeLatch =
                new java.util.concurrent.CountDownLatch(1);

        /** 服务器关闭码(4004=认证失败);经网络失败关闭则保持 -1。 */
        private volatile int closeCode = -1;

        private final long[] heartbeatMs = {30_000};

        /** Kept to cancel heartbeat when this WS connection closes. */
        private volatile ScheduledFuture<?> heartbeatTask;

        WsListener(Consumer<InboundMsg> onC2C, Consumer<QqEvents.Interaction> onInteraction) {
            this.onC2C = onC2C;
            this.onInteraction = onInteraction;
        }

        void awaitClose() throws InterruptedException {
            closeLatch.await();
        }

        /** 最近一次关闭码;-1 表示网络失败(非服务器关闭)。 */
        int closeCode() {
            return closeCode;
        }

        @Override
        public void onOpen(@NotNull WebSocket webSocket, @NotNull Response response) {
            log.info("QqWsClient: WS opened");
        }

        @Override
        public void onMessage(@NotNull WebSocket webSocket, @NotNull String text) {
            handleFrame(text, webSocket, onC2C, onInteraction, heartbeatMs);
            // Schedule heartbeat after first Hello sets the interval
            if (heartbeatMs[0] > 0 && heartbeatTask == null) {
                long interval = heartbeatMs[0];
                heartbeatTask = heartbeatScheduler.scheduleAtFixedRate(() -> {
                    long s = lastSeq.get();
                    webSocket.send(heartbeatPayload(s == 0 ? null : s));
                    log.trace("QqWsClient: heartbeat sent (seq={})", s);
                }, interval, interval, TimeUnit.MILLISECONDS);
            }
        }

        @Override
        public void onClosing(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
            this.closeCode = code;
            log.info("QqWsClient: WS closing code={} reason={}", code, reason);
            webSocket.close(code, reason);
        }

        @Override
        public void onClosed(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
            this.closeCode = code;
            log.info("QqWsClient: WS closed code={} reason={}", code, reason);
            cancelHeartbeat();
            closeLatch.countDown();
        }

        @Override
        public void onFailure(@NotNull WebSocket webSocket, @NotNull Throwable t,
                              Response response) {
            log.warn("QqWsClient: WS failure", t);
            cancelHeartbeat();
            closeLatch.countDown();
        }

        private void cancelHeartbeat() {
            ScheduledFuture<?> f = heartbeatTask;
            if (f != null) {
                f.cancel(false);
                heartbeatTask = null;
            }
        }
    }
}
