package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.gateway.Authorizer;
import com.lyhn.wraith.gateway.GatewayRenderer;
import com.lyhn.wraith.gateway.GatewaySession;
import com.lyhn.wraith.gateway.ImTurnDriver;
import com.lyhn.wraith.gateway.SessionRouter;
import com.lyhn.wraith.hitl.ApprovalResult;
import okhttp3.OkHttpClient;
import okhttp3.WebSocket;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 端到端集成:mock QQ WebSocket 帧 → {@link QqWsClient#handleFrame} 分发 →
 * {@link ImTurnDriver} → 真 {@link QqApiClient} 打到 {@link MockWebServer}。
 *
 * <p>不起真 socket:直接喂 JSON 帧到 Task 11 暴露的<b>包私</b> {@code handleFrame} 缝。
 * 因该缝是 {@code com.lyhn.wraith.gateway.qq} 的包私方法,本测试与之同包(而非
 * task-13-brief 写的 {@code com.lyhn.wraith.gateway})才能直呼——见测试报告的 concern。
 *
 * <p>onC2C / onInteraction 两个 Consumer 的接线<b>逐字复刻</b>
 * {@code GatewayDaemon.start}(authz + dedup + lastMsgId + driver.onMessage;
 * ack + authz-on-openid + QqApproval.parse + driver.onApproval)。会话用 mock 的
 * {@link GatewaySession}(runTurn→"pong",renderer()→mock {@link GatewayRenderer}),
 * 故永不触网 / 不起 MCP。
 *
 * <p>HTTP 侧用 {@link MockWebServer} + 按 path 路由的 {@link Dispatcher}(而非 FIFO enqueue),
 * 以消除异步 C2C POST(pool 线程)与同步 ack PUT(驱动线程)的响应顺序竞争。
 */
class GatewayIntegrationTest {

    private static final String OWNER = "O_OWNER";

    private MockWebServer server;
    private OkHttpClient http;
    private ExecutorService pool;

    @BeforeEach
    void up() throws Exception {
        server = new MockWebServer();
        // 按 path 路由:token / C2C 发送 / interaction ack 各返自己的 200,
        // 不依赖 enqueue 顺序 —— 异步回发与同步 ack 交错也稳定。
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath() == null ? "" : request.getPath();
                if (path.contains("/getAppAccessToken")) {
                    return new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}");
                }
                if (path.startsWith("/interactions/")) {
                    return new MockResponse().setBody("{}");                // ack PUT
                }
                if (path.contains("/messages")) {
                    return new MockResponse().setBody("{\"id\":\"srv-1\"}"); // C2C send
                }
                return new MockResponse().setResponseCode(404);
            }
        });
        server.start();
        http = new OkHttpClient();
        pool = Executors.newCachedThreadPool();
    }

    @AfterEach
    void down() throws Exception {
        pool.shutdownNow();
        server.shutdown();
    }

    private QqApiClient api() {
        String base = server.url("/").toString().replaceAll("/$", "");
        return new QqApiClient("APP", "SECRET", base, base + "/app/getAppAccessToken", http);
    }

    // ── Assertion A:C2C 帧 → 回合 → 带 msg_id 的 "pong" 打到 /v2/users/{openid}/messages ──
    @Test
    @Timeout(15)
    void c2cFrameDrivesTurnAndPostsPassivePong() throws Exception {
        QqApiClient api = api();
        Authorizer authz = new Authorizer(OWNER);
        Dedup dedup = new Dedup(1000);
        Map<String, String> lastMsgId = new ConcurrentHashMap<>();

        GatewaySession sess = mock(GatewaySession.class);
        when(sess.runTurn("在吗")).thenReturn("pong");
        SessionRouter router = new SessionRouter(openid -> sess);

        // 回发完成后放闸,好去 MockWebServer 取记录。
        CountDownLatch sent = new CountDownLatch(1);
        ImTurnDriver driver = new ImTurnDriver(router, (openid, text, replyTo) -> {
            try {
                api.sendC2C(openid, text, replyTo);
            } catch (IOException e) {
                throw new RuntimeException(e);
            } finally {
                sent.countDown();
            }
        }, pool);

        // 逐字复刻 GatewayDaemon.start 的 onC2C 接线。
        Consumer<InboundMsg> onC2C = inbound -> {
            if (authz.isAllowed(inbound.openid()) && !dedup.seen(inbound.msgId())) {
                lastMsgId.put(inbound.openid(), inbound.msgId());
                driver.onMessage(inbound);
            }
        };
        Consumer<QqEvents.Interaction> onInteraction = i -> { };

        QqWsClient ws = new QqWsClient(api, http);
        WebSocket sock = mock(WebSocket.class);
        String frame = "{\"op\":0,\"s\":1,\"t\":\"C2C_MESSAGE_CREATE\",\"d\":{"
                + "\"author\":{\"user_openid\":\"" + OWNER + "\"},"
                + "\"content\":\"在吗\",\"id\":\"MSG_IN_1\"}}";
        ws.handleFrame(frame, sock, onC2C, onInteraction, new long[]{0});

        assertTrue(sent.await(10, TimeUnit.SECONDS), "回合应在超时内跑完并回发");

        // MockWebServer 收到:token(先行)+ 一条 /v2/users/{owner}/messages,body 带 msg_id + "pong"。
        RecordedRequest send = takeUntilPath(server, "/v2/users/" + OWNER + "/messages", 3);
        assertNotNull(send, "应向 /v2/users/{owner}/messages 发出 POST");
        assertEquals("POST", send.getMethod());
        assertTrue(send.getHeader("Authorization").startsWith("QQBot "), "带 QQBot token");
        String body = send.getBody().readUtf8();
        assertTrue(body.contains("\"content\":\"pong\""), "body 应含 pong 回复:" + body);
        assertTrue(body.contains("\"msg_id\":\"MSG_IN_1\""), "body 应带被动回复 msg_id:" + body);
    }

    // ── Assertion B:INTERACTION 帧 → ack PUT + onApproval 路由到 renderer.resolveApproval(APPROVED) ──
    @Test
    @Timeout(15)
    void interactionFrameAcksAndRoutesApprovalToRenderer() throws Exception {
        QqApiClient api = api();
        Authorizer authz = new Authorizer(OWNER);

        GatewaySession sess = mock(GatewaySession.class);
        GatewayRenderer renderer = mock(GatewayRenderer.class);
        when(sess.renderer()).thenReturn(renderer);
        SessionRouter router = new SessionRouter(openid -> sess);

        ImTurnDriver driver = new ImTurnDriver(router, (o, t, r) -> { }, pool);

        // 逐字复刻 GatewayDaemon.start 的 onInteraction 接线。
        Consumer<QqEvents.Interaction> onInteraction = interaction -> {
            try {
                api.ackInteraction(interaction.id());
            } catch (IOException ignored) {
                // best-effort ack
            }
            if (!authz.isAllowed(interaction.openid())) return; // deny-all on QQ-authenticated openid
            QqApproval.Callback cb = QqApproval.parse(interaction.buttonData());
            if (cb != null) driver.onApproval(cb.sessionKey(), cb.result());
        };

        QqWsClient ws = new QqWsClient(api, http);
        WebSocket sock = mock(WebSocket.class);
        String frame = "{\"op\":0,\"s\":2,\"t\":\"INTERACTION_CREATE\",\"d\":{"
                + "\"id\":\"INT_1\",\"user_openid\":\"" + OWNER + "\","
                + "\"data\":{\"resolved\":{\"button_data\":\"approve:" + OWNER + ":allow-once\"}}}}";
        ws.handleFrame(frame, sock, i -> { }, onInteraction, new long[]{0});

        // (a) ack:MockWebServer 收到 PUT /interactions/INT_1。
        RecordedRequest ack = takeUntilPath(server, "/interactions/INT_1", 3);
        assertNotNull(ack, "应向 /interactions/INT_1 发出 ack");
        assertEquals("PUT", ack.getMethod());

        // (b) 路由:onApproval 到达会话 renderer,决策 = APPROVED(allow-once)。
        ArgumentCaptor<ApprovalResult> cap = ArgumentCaptor.forClass(ApprovalResult.class);
        verify(renderer).resolveApproval(cap.capture());
        assertEquals(ApprovalResult.Decision.APPROVED, cap.getValue().decision(),
                "allow-once 应路由为 APPROVED");
    }

    /**
     * 从 MockWebServer 里取到路径命中 {@code wantPath} 的请求(至多看 {@code maxDrain} 条,
     * 跳过 token 等先行请求);超时或耗尽返回 null。
     */
    private static RecordedRequest takeUntilPath(MockWebServer server, String wantPath, int maxDrain)
            throws InterruptedException {
        for (int i = 0; i < maxDrain; i++) {
            RecordedRequest r = server.takeRequest(5, TimeUnit.SECONDS);
            if (r == null) return null;
            if (r.getPath() != null && r.getPath().equals(wantPath)) return r;
        }
        return null;
    }
}
