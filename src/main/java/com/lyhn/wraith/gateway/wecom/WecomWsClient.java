package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 企微智能机器人长连接客户端(okhttp WebSocket)。connect() 阻塞重连循环:
 * 建连 → 发 aibot_subscribe → 30s ping 心跳 → 收帧经 handleFrame 分发 → 断线退避重连。
 * 帧分发逻辑收在包私 handleFrame,可脱网单测。
 */
public final class WecomWsClient {

    private static final Logger log = LoggerFactory.getLogger(WecomWsClient.class);
    private static final String WS_URL = "wss://openws.work.weixin.qq.com";
    private static final long[] BACKOFF = {2, 5, 10, 30, 60};

    public interface OnInbound { void onMessage(WecomFrames.Inbound m); }
    public interface OnStatus { void onStatus(String wireToken); }
    public interface OnEvent { void onEvent(WecomFrames.CardEvent ev); }

    private final OkHttpClient http;
    private final String botId;
    private final String secret;

    private volatile WebSocket ws;
    private volatile boolean stopping;
    private volatile String subscribeReqId;

    private ScheduledExecutorService heartbeat;

    public WecomWsClient(OkHttpClient http, String botId, String secret) {
        this.http = http;
        this.botId = botId;
        this.secret = secret;
    }

    public static long backoffSeconds(int attempt) {
        return BACKOFF[Math.min(Math.max(attempt, 0), BACKOFF.length - 1)];
    }

    /** 包私:测试注入订阅 reqId 以驱动 handleFrame 的订阅判定分支。 */
    void setSubscribeReqIdForTest(String reqId) { this.subscribeReqId = reqId; }

    /** 阻塞重连循环。放守护线程跑。 */
    public void connect(OnInbound onInbound, OnStatus onStatus) {
        connect(onInbound, onStatus, ev -> {});
    }

    /** 阻塞重连循环(带事件回调)。放守护线程跑。 */
    public void connect(OnInbound onInbound, OnStatus onStatus, OnEvent onEvent) {
        int attempt = 0;
        while (!stopping) {
            final CountDownLatch closed = new CountDownLatch(1);
            onStatus.onStatus("disconnected"); // 连接中先视为未就绪;subscribed 后点亮
            this.subscribeReqId = UUID.randomUUID().toString();
            Request req = new Request.Builder().url(WS_URL).build();
            WebSocket socket = http.newWebSocket(req, new WebSocketListener() {
                @Override public void onOpen(@NotNull WebSocket webSocket, @NotNull Response response) {
                    webSocket.send(WecomFrames.subscribeFrame(botId, secret, subscribeReqId));
                    startHeartbeat(webSocket);
                }
                @Override public void onMessage(@NotNull WebSocket webSocket, @NotNull String text) {
                    try { handleFrame(text, onInbound, onStatus, onEvent); }
                    catch (Exception e) { log.warn("[gateway] 企微帧处理异常: {}", e.toString()); }
                }
                @Override public void onClosing(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
                    webSocket.close(1000, null);
                }
                @Override public void onClosed(@NotNull WebSocket webSocket, int code, @NotNull String reason) {
                    stopHeartbeat(); closed.countDown();
                }
                @Override public void onFailure(@NotNull WebSocket webSocket, @NotNull Throwable t, Response response) {
                    log.warn("[gateway] 企微长连接失败: {}", t.toString());
                    stopHeartbeat(); closed.countDown();
                }
            });
            this.ws = socket;
            try { closed.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            if (stopping) break;
            onStatus.onStatus("disconnected");
            long wait = backoffSeconds(attempt++);
            try { TimeUnit.SECONDS.sleep(wait); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        stopHeartbeat();
    }

    /** 收帧分发:订阅结果 → 状态灯;卡片事件 → onEvent;aibot_msg_callback → onInbound。 */
    void handleFrame(String text, OnInbound onInbound, OnStatus onStatus, OnEvent onEvent) {
        WecomFrames.SubResult sub = WecomFrames.parseSubscribeResult(text, subscribeReqId);
        if (sub == WecomFrames.SubResult.SUBSCRIBED) { onStatus.onStatus("subscribed"); return; }
        if (sub == WecomFrames.SubResult.AUTH_FAILED) { onStatus.onStatus("auth-failed"); return; }
        WecomFrames.CardEvent ce = WecomFrames.parseCardEvent(text);
        if (ce != null) { onEvent.onEvent(ce); return; }
        WecomFrames.Inbound in = WecomFrames.parseCallback(text);
        if (in != null) onInbound.onMessage(in);
    }

    /** 回复 markdown(复用入站 reqId)。 */
    public void respondMarkdown(String reqId, String content) {
        WebSocket w = this.ws;
        if (w != null) w.send(WecomFrames.respondMarkdownFrame(reqId, content));
    }

    /** 回复卡片(复用入站 reqId)。 */
    public void respondCard(String reqId, String cardJson) {
        WebSocket w = this.ws;
        if (w != null) w.send(WecomFrames.respondCardFrame(reqId, cardJson));
    }

    /** 主动推送 markdown。 */
    public void sendMarkdown(String chatId, String content) {
        WebSocket w = this.ws;
        if (w != null) w.send(WecomFrames.sendMarkdownFrame(chatId, content));
    }

    /** 主动推送卡片。 */
    public void sendCard(String chatId, String cardJson) {
        WebSocket w = this.ws;
        if (w != null) w.send(WecomFrames.sendCardFrame(chatId, cardJson));
    }

    public void stop() {
        stopping = true;
        stopHeartbeat();
        WebSocket w = this.ws;
        if (w != null) { try { w.close(1000, null); } catch (Exception ignored) {} }
    }

    private synchronized void startHeartbeat(WebSocket socket) {
        stopHeartbeat();
        heartbeat = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "wecom-heartbeat");
            t.setDaemon(true);
            return t;
        });
        heartbeat.scheduleAtFixedRate(() -> {
            try { socket.send(WecomFrames.pingFrame(UUID.randomUUID().toString())); }
            catch (Exception e) { log.warn("[gateway] 企微心跳发送失败: {}", e.toString()); }
        }, 30, 30, TimeUnit.SECONDS);
    }

    private synchronized void stopHeartbeat() {
        if (heartbeat != null) { heartbeat.shutdownNow(); heartbeat = null; }
    }
}
