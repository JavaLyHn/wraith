package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.automation.delivery.PassiveWindow;
import com.lyhn.wraith.automation.delivery.QqDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.gateway.Authorizer;
import okhttp3.OkHttpClient;
import okhttp3.WebSocket;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * 集成测试：onC2C 入站触发 QqDeliveryAdapter.flush — 仿 GatewayIntegrationTest 的
 * MockWebServer + path-routing Dispatcher 模式，重建 GatewayDaemon.start 里的
 * onC2C flush 接线。
 *
 * <p>同包 {@code com.lyhn.wraith.gateway.qq} 以使用包私 {@code QqWsClient.handleFrame} 缝。
 *
 * <p>测试场景：
 * <ol>
 *   <li>QqPendingStore 预存 2 条待发；入站 C2C 帧触发 onC2C，其中调用
 *       {@code qqDeliver.flush(inbound.msgId())}，断言 MockWebServer
 *       收到恰好一条 POST /v2/users/{owner}/messages（合并摘要），且 pending 被清空。</li>
 *   <li>PassiveWindow lambda 逻辑：新鲜 (&lt; 60 min) → 返回 msgId；过期 → null。</li>
 * </ol>
 *
 * <p>HTTP 端："SECRET" 是测试固件值，仅对 localhost MockWebServer 有效，不外泄。
 */
class AutomationDeliveryFlushTest {

    private static final String OWNER = "FLUSH_OWNER";

    @TempDir
    Path tempDir;

    private MockWebServer server;
    private OkHttpClient http;

    @BeforeEach
    void up() throws Exception {
        server = new MockWebServer();
        // path 路由：token endpoint + C2C messages endpoint
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath() == null ? "" : request.getPath();
                if (path.contains("/getAppAccessToken")) {
                    return new MockResponse()
                            .setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}")
                            .addHeader("Content-Type", "application/json");
                }
                if (path.contains("/messages")) {
                    return new MockResponse()
                            .setBody("{\"id\":\"flush-1\"}")
                            .addHeader("Content-Type", "application/json");
                }
                return new MockResponse().setResponseCode(404);
            }
        });
        server.start();
        http = new OkHttpClient();
    }

    @AfterEach
    void down() throws Exception {
        server.shutdown();
    }

    private QqApiClient api() {
        String base = server.url("/").toString().replaceAll("/$", "");
        // "SECRET" is a test-fixture canary only — never leaves localhost MockWebServer
        return new QqApiClient("APP", "SECRET", base, base + "/app/getAppAccessToken", http);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Assertion A: C2C 入站 → flush 冲刷 pending → 一条 coalesced POST，pending 清空
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void c2cInbound_flushesAllPending_exactlyOnePost() throws Exception {
        QqApiClient api = api();
        QqPendingStore pending = new QqPendingStore(tempDir);

        // 预存 2 条待发
        QqPendingStore.Pending p1 = new QqPendingStore.Pending();
        p1.taskName = "task-alpha";
        p1.answer = "Alpha result";
        p1.ts = System.currentTimeMillis() - 1000;
        pending.enqueue(p1);

        QqPendingStore.Pending p2 = new QqPendingStore.Pending();
        p2.taskName = "task-beta";
        p2.answer = "Beta result";
        p2.ts = System.currentTimeMillis() - 500;
        pending.enqueue(p2);

        assertEquals(2, pending.size(), "pre-condition: 2 pending items");

        // PassiveWindow: 总是无新鲜 msgId（测试 flush 路径，不走即发路径）
        PassiveWindow window = openid -> null;
        QqDeliveryAdapter qqDeliver = new QqDeliveryAdapter(OWNER, api, pending, window);

        // 共享状态
        Map<String, String> lastMsgId = new ConcurrentHashMap<>();
        Map<String, Long> lastInboundAt = new ConcurrentHashMap<>();

        Authorizer authz = new Authorizer(OWNER);
        Dedup dedup = new Dedup(1000);

        // flush 结束后放闸（flush 在驱动线程同步执行 → 直接信号）
        CountDownLatch flushed = new CountDownLatch(1);

        // 重建 GatewayDaemon.start 里的 onC2C 接线（含 Task-12 新增的 lastInboundAt + flush）
        Consumer<InboundMsg> onC2C = inbound -> {
            if (authz.isAllowed(inbound.openid()) && !dedup.seen(inbound.msgId())) {
                lastMsgId.put(inbound.openid(), inbound.msgId());
                lastInboundAt.put(inbound.openid(), System.currentTimeMillis());
                qqDeliver.flush(inbound.msgId());
                flushed.countDown();
            }
        };
        Consumer<QqEvents.Interaction> onInteraction = i -> { };

        QqWsClient ws = new QqWsClient(api, http);
        WebSocket sock = mock(WebSocket.class);
        String frame = "{\"op\":0,\"s\":1,\"t\":\"C2C_MESSAGE_CREATE\",\"d\":{"
                + "\"author\":{\"user_openid\":\"" + OWNER + "\"},"
                + "\"content\":\"hi\",\"id\":\"MSG_FLUSH_1\"}}";
        ws.handleFrame(frame, sock, onC2C, onInteraction, new long[]{0});

        assertTrue(flushed.await(5, TimeUnit.SECONDS), "flush 应在超时内完成");

        // 找到 /messages POST
        RecordedRequest send = takeUntilMessages(3);
        assertNotNull(send, "应向 /v2/users/{owner}/messages 发出 POST");
        assertEquals("POST", send.getMethod());
        assertTrue(send.getPath().contains("/v2/users/" + OWNER + "/messages"),
                "path 应命中 owner: " + send.getPath());

        String body = send.getBody().readUtf8();
        assertTrue(body.contains("task-alpha"), "coalesced body 含 task-alpha: " + body);
        assertTrue(body.contains("task-beta"), "coalesced body 含 task-beta: " + body);
        assertTrue(body.contains("\"msg_id\":\"MSG_FLUSH_1\""),
                "flush body 应带入站 msg_id: " + body);

        // pending 已清空
        assertEquals(0, pending.size(), "flush 后 pending 应清空");

        // 不应有第二条 /messages POST
        RecordedRequest extra = server.takeRequest(200, TimeUnit.MILLISECONDS);
        if (extra != null && extra.getPath() != null && extra.getPath().contains("/messages")) {
            fail("flush 不应发出超过一条 /messages 请求: " + extra.getPath());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Assertion B: PassiveWindow lambda 60-min 逻辑
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void passiveWindow_freshWithin60min_returnsMsgId() {
        Map<String, String> lastMsgId = new ConcurrentHashMap<>();
        Map<String, Long> lastInboundAt = new ConcurrentHashMap<>();

        // PassiveWindow 逐字复刻 GatewayDaemon.start 里的 lambda
        PassiveWindow window = openid -> {
            Long t = lastInboundAt.get(openid);
            String mid = lastMsgId.get(openid);
            return (mid != null && t != null
                    && System.currentTimeMillis() - t < 60 * 60 * 1000L)
                    ? mid : null;
        };

        // Case 1: 无记录 → null
        assertNull(window.freshMsgId("nobody"), "无记录应返回 null");

        // Case 2: 记录新鲜（刚刚）→ 返回 msgId
        lastMsgId.put("alice", "MSG_123");
        lastInboundAt.put("alice", System.currentTimeMillis());
        assertEquals("MSG_123", window.freshMsgId("alice"), "新鲜入站应返回 msgId");

        // Case 3: 入站时间戳 = 59 分 59 秒前 → 仍在窗口内 → 返回 msgId
        lastMsgId.put("bob", "MSG_456");
        lastInboundAt.put("bob", System.currentTimeMillis() - (59 * 60 * 1000L + 59_000L));
        assertEquals("MSG_456", window.freshMsgId("bob"), "59m59s 前仍在 60min 窗口内，应返回 msgId");

        // Case 4: 入站时间戳 = 60 分 1 秒前（过期）→ null
        lastMsgId.put("carol", "MSG_789");
        lastInboundAt.put("carol", System.currentTimeMillis() - (60 * 60 * 1000L + 1_000L));
        assertNull(window.freshMsgId("carol"), "超过 60min 应返回 null");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Assertion C: 无待发时 flush 返回 null，不发任何请求
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void c2cInbound_noPending_noPost_flushReturnsNull() throws Exception {
        QqApiClient api = api();
        QqPendingStore pending = new QqPendingStore(tempDir);
        assertEquals(0, pending.size(), "pre-condition: no pending");

        PassiveWindow window = openid -> null;
        QqDeliveryAdapter qqDeliver = new QqDeliveryAdapter(OWNER, api, pending, window);

        Map<String, String> lastMsgId = new ConcurrentHashMap<>();
        Map<String, Long> lastInboundAt = new ConcurrentHashMap<>();
        Authorizer authz = new Authorizer(OWNER);
        Dedup dedup = new Dedup(1000);

        CountDownLatch reached = new CountDownLatch(1);

        Consumer<InboundMsg> onC2C = inbound -> {
            if (authz.isAllowed(inbound.openid()) && !dedup.seen(inbound.msgId())) {
                lastMsgId.put(inbound.openid(), inbound.msgId());
                lastInboundAt.put(inbound.openid(), System.currentTimeMillis());
                String result = qqDeliver.flush(inbound.msgId());
                // flush 无待发返回 null
                assertNull(result, "无待发时 flush 应返回 null");
                reached.countDown();
            }
        };

        QqWsClient ws = new QqWsClient(api, http);
        WebSocket sock = mock(WebSocket.class);
        String frame = "{\"op\":0,\"s\":1,\"t\":\"C2C_MESSAGE_CREATE\",\"d\":{"
                + "\"author\":{\"user_openid\":\"" + OWNER + "\"},"
                + "\"content\":\"hi\",\"id\":\"MSG_EMPTY\"}}";
        ws.handleFrame(frame, sock, onC2C, i -> { }, new long[]{0});

        assertTrue(reached.await(5, TimeUnit.SECONDS), "onC2C 应在超时内执行");

        // 不应有任何 /messages 请求（token 请求也不应触发，因为 api 未被调用）
        RecordedRequest req = server.takeRequest(300, TimeUnit.MILLISECONDS);
        if (req != null && req.getPath() != null && req.getPath().contains("/messages")) {
            fail("无待发时不应发出 /messages 请求: " + req.getPath());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** 从 MockWebServer 取请求，直到找到包含 /messages 的路径（最多看 maxDrain 条）。 */
    private RecordedRequest takeUntilMessages(int maxDrain) throws InterruptedException {
        for (int i = 0; i < maxDrain; i++) {
            RecordedRequest r = server.takeRequest(3, TimeUnit.SECONDS);
            if (r == null) return null;
            if (r.getPath() != null && r.getPath().contains("/messages")) return r;
        }
        return null;
    }
}
