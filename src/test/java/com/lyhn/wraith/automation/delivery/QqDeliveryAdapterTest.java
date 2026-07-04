package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import com.lyhn.wraith.gateway.qq.QqApiClient;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MockWebServer integration test for QqDeliveryAdapter.
 *
 * <p>Three cases:
 * <ol>
 *   <li>window-in: PassiveWindow returns a live msgId → POST hits /v2/users/{owner}/messages; pending stays empty.</li>
 *   <li>window-out: PassiveWindow returns null → no request sent; pending size == 1.</li>
 *   <li>flush with 2 pending → exactly ONE coalesced POST containing both task names; pending drained to 0.</li>
 * </ol>
 *
 * <p>Uses a path-routing Dispatcher (token endpoint + messages endpoint),
 * mirroring QqApiClientKeyboardTest. The app-secret value "SECRET" is a
 * test-fixture canary only — it never leaves localhost.
 */
class QqDeliveryAdapterTest {

    private static final String OWNER_OPENID = "owner-openid-1";

    private MockWebServer server;
    private QqApiClient api;
    private Path tempDir;
    private QqPendingStore pendingStore;
    private DeliveryTarget target;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath();
                if (path != null && path.contains("getAppAccessToken")) {
                    return new MockResponse()
                            .setBody("{\"access_token\":\"tok\",\"expires_in\":7200}")
                            .addHeader("Content-Type", "application/json");
                }
                // /v2/users/{openid}/messages
                return new MockResponse()
                        .setBody("{\"id\":\"m1\"}")
                        .addHeader("Content-Type", "application/json");
            }
        });
        server.start();

        String base = server.url("/").toString().replaceAll("/$", "");
        String tokenUrl = server.url("/getAppAccessToken").toString();
        // "SECRET" is a test-fixture value only — see report note.
        api = new QqApiClient("appid", "SECRET", base, tokenUrl, new OkHttpClient());

        tempDir = Files.createTempDirectory("qq-pending-test");
        pendingStore = new QqPendingStore(tempDir);

        target = new DeliveryTarget();
        target.platform = "qq";
        target.chatId = OWNER_OPENID;
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
        // clean up temp dir
        try (var walk = Files.walk(tempDir)) {
            walk.sorted(java.util.Comparator.reverseOrder())
                .map(Path::toFile)
                .forEach(java.io.File::delete);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: build a task + result
    // ─────────────────────────────────────────────────────────────────────────

    private AutomationTask makeTask(String name) {
        AutomationTask t = new AutomationTask();
        t.id = "id-" + name;
        t.name = name;
        t.prompt = "do " + name;
        return t;
    }

    private AutomationRunner.RunResult makeResult(String answer) {
        return new AutomationRunner.RunResult("success", answer, "sess-1", List.of());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 1: window-in → immediate send via sendC2C
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void windowIn_sendImmediately_pendingStaysEmpty() throws Exception {
        PassiveWindow window = openid -> "LIVE_MSG_ID";  // always has a fresh msgId
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        adapter.deliver(target, makeTask("daily-report"), makeResult("All green"));

        // drain the token request first, then find the messages request
        RecordedRequest messagesReq = drainUntilMessages();
        assertNotNull(messagesReq, "window-in: should POST to /messages");
        String path = messagesReq.getPath();
        assertNotNull(path);
        assertTrue(path.contains("/v2/users/" + OWNER_OPENID + "/messages"),
                "path should target owner openid: " + path);

        String body = messagesReq.getBody().readUtf8();
        assertTrue(body.contains("daily-report"), "body should contain task name: " + body);
        assertTrue(body.contains("All green"), "body should contain answer: " + body);
        assertTrue(body.contains("\"msg_id\":\"LIVE_MSG_ID\""), "body should carry reply msgId: " + body);

        assertEquals(0, pendingStore.size(), "pending should remain empty after direct send");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 2: window-out → enqueue, no request sent
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void windowOut_enqueues_noRequestSent() throws Exception {
        PassiveWindow window = openid -> null;  // no live msgId
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        adapter.deliver(target, makeTask("nightly-backup"), makeResult("Backup done"));

        // No requests should have been sent at all (not even token)
        RecordedRequest req = server.takeRequest(300, TimeUnit.MILLISECONDS);
        assertNull(req, "window-out: no HTTP request should be sent");

        assertEquals(1, pendingStore.size(), "pending should have exactly 1 item");
        List<QqPendingStore.Pending> items = pendingStore.drainAll();
        assertEquals("nightly-backup", items.get(0).taskName);
        assertEquals("Backup done", items.get(0).answer);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 3: flush with 2 pending → ONE coalesced POST, pending drained
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_coalescesIntroOnePost_pendingDrained() throws Exception {
        PassiveWindow window = openid -> null;  // window out → enqueue both
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        adapter.deliver(target, makeTask("task-alpha"), makeResult("Alpha result"));
        adapter.deliver(target, makeTask("task-beta"), makeResult("Beta result"));

        assertEquals(2, pendingStore.size(), "should have 2 pending before flush");

        // No requests yet
        assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS), "no requests before flush");

        String digest = adapter.flush("FLUSH_MSG_ID");

        assertNotNull(digest, "flush should return the digest string");
        assertTrue(digest.contains("task-alpha"), "digest should contain task-alpha: " + digest);
        assertTrue(digest.contains("task-beta"), "digest should contain task-beta: " + digest);
        assertTrue(digest.contains("2"), "digest should mention 2 items: " + digest);

        // Exactly ONE messages request (after the token request)
        RecordedRequest messagesReq = drainUntilMessages();
        assertNotNull(messagesReq, "flush: should POST to /messages");
        String path = messagesReq.getPath();
        assertNotNull(path);
        assertTrue(path.contains("/v2/users/" + OWNER_OPENID + "/messages"),
                "flush path should target owner: " + path);

        String body = messagesReq.getBody().readUtf8();
        assertTrue(body.contains("task-alpha"), "coalesced body contains task-alpha: " + body);
        assertTrue(body.contains("task-beta"), "coalesced body contains task-beta: " + body);
        assertTrue(body.contains("\"msg_id\":\"FLUSH_MSG_ID\""), "flush body carries reply msgId: " + body);

        // No second messages request
        RecordedRequest extra = server.takeRequest(100, TimeUnit.MILLISECONDS);
        // If extra is a messages request, fail; token requests are fine to see
        if (extra != null && extra.getPath() != null && extra.getPath().contains("/messages")) {
            fail("flush sent more than one /messages request: " + extra.getPath());
        }

        assertEquals(0, pendingStore.size(), "pending should be drained after flush");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 4: flush fails (HTTP 500) → items re-enqueued, flush returns null
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_sendFailure_reEnqueuesItems_returnsNull() throws Exception {
        // Token endpoint still 200s; messages endpoint returns 500 to simulate network error
        server.setDispatcher(new Dispatcher() {
            @Override
            public okhttp3.mockwebserver.MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath();
                if (path != null && path.contains("getAppAccessToken")) {
                    return new MockResponse()
                            .setBody("{\"access_token\":\"tok\",\"expires_in\":7200}")
                            .addHeader("Content-Type", "application/json");
                }
                // messages endpoint fails
                return new MockResponse().setResponseCode(500);
            }
        });

        PassiveWindow window = openid -> null;  // window out → enqueue both
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        adapter.deliver(target, makeTask("task-x"), makeResult("Result X"));
        adapter.deliver(target, makeTask("task-y"), makeResult("Result Y"));
        assertEquals(2, pendingStore.size(), "should have 2 pending before flush");

        // flush should not throw, and should return null because send failed
        String result = adapter.flush("FAIL_MSG_ID");

        assertNull(result, "flush should return null when send fails");
        assertEquals(2, pendingStore.size(), "pending items should be re-enqueued after send failure");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Drains queued requests until a /messages request is found (max 3 tries, 1s each). */
    private RecordedRequest drainUntilMessages() throws InterruptedException {
        for (int i = 0; i < 5; i++) {
            RecordedRequest r = server.takeRequest(1, TimeUnit.SECONDS);
            if (r == null) break;
            if (r.getPath() != null && r.getPath().contains("/messages")) return r;
        }
        return null;
    }
}
