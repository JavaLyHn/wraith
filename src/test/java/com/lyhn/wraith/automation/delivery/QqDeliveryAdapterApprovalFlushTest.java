package com.lyhn.wraith.automation.delivery;

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
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MockWebServer tests for QqDeliveryAdapter.flush() with approval-pending items.
 *
 * <p>Task-14 requirement: approval-pending items (approvalId != null) must be sent
 * as SEPARATE keyboard messages (sendC2CWithKeyboard), while plain delivery items
 * continue to be coalesced into a single sendC2C. Mixed queues must be handled
 * correctly.
 *
 * <p>"SECRET" is a test-fixture canary value only — it never leaves localhost.
 */
class QqDeliveryAdapterApprovalFlushTest {

    private static final String OWNER_OPENID = "owner-openid-approval-test";

    private MockWebServer server;
    private QqApiClient api;
    private Path tempDir;
    private QqPendingStore pendingStore;

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

        tempDir = Files.createTempDirectory("qq-approval-flush-test");
        pendingStore = new QqPendingStore(tempDir);
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
        try (var walk = Files.walk(tempDir)) {
            walk.sorted(java.util.Comparator.reverseOrder())
                .map(Path::toFile)
                .forEach(java.io.File::delete);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 1: single approval-pending item → keyboard message sent
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_approvalItem_sendsKeyboardMessage() throws Exception {
        PassiveWindow window = openid -> null;  // no live window — forces enqueue path
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        // Enqueue an approval-pending item directly
        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "daily-task";
        ap.answer = "needs approval";
        ap.ts = System.currentTimeMillis();
        ap.approvalId = "run-99#1";
        pendingStore.enqueue(ap);

        assertEquals(1, pendingStore.size(), "should have 1 item before flush");

        assertEquals(1, adapter.flush("FRESH_MSG_ID"), "one approval delivered");

        // Should see a keyboard (msg_type=2) request
        RecordedRequest req = drainUntilMessages();
        assertNotNull(req, "flush should POST a message for approval item");
        String body = req.getBody().readUtf8();

        // The keyboard message must contain the approvalId embedded in the button data
        assertTrue(body.contains("run-99#1"), "keyboard body must contain the approvalId: " + body);
        // msg_type=2 for keyboard messages
        assertTrue(body.contains("\"msg_type\":2"), "keyboard message must use msg_type=2: " + body);
        // Must contain keyboard field
        assertTrue(body.contains("\"keyboard\""), "body must contain keyboard field: " + body);

        assertEquals(0, pendingStore.size(), "pending should be drained after successful flush");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 2: approval + plain items → keyboard + coalesced sendC2C (two POSTs)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_mixedItems_sendsKeyboardPlusCoalesced() throws Exception {
        PassiveWindow window = openid -> null;
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        // Enqueue approval-pending item
        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "task-needs-approval";
        ap.answer = "needs your approval";
        ap.ts = System.currentTimeMillis();
        ap.approvalId = "run-mixed#2";
        pendingStore.enqueue(ap);

        // Enqueue plain delivery item
        QqPendingStore.Pending plain = new QqPendingStore.Pending();
        plain.taskName = "task-plain";
        plain.answer = "plain result";
        plain.ts = System.currentTimeMillis();
        plain.approvalId = null;
        pendingStore.enqueue(plain);

        assertEquals(2, pendingStore.size());

        int delivered = adapter.flush("FRESH_MIXED");

        assertEquals(2, delivered, "1 approval + 1 plain delivered");

        // Collect all message requests
        RecordedRequest first = drainUntilMessages();
        assertNotNull(first, "at least one messages request expected");

        RecordedRequest second = drainUntilMessages();
        assertNotNull(second, "second messages request expected for mixed queue");

        // One must be keyboard (msg_type=2), the other must be plain text (msg_type=0)
        String body1 = first.getBody().readUtf8();
        String body2 = second.getBody().readUtf8();

        boolean hasKeyboard = body1.contains("\"msg_type\":2") || body2.contains("\"msg_type\":2");
        boolean hasPlain = body1.contains("\"msg_type\":0") || body2.contains("\"msg_type\":0");

        assertTrue(hasKeyboard, "one request must be a keyboard message");
        assertTrue(hasPlain, "one request must be a plain coalesced message");

        // Verify task-plain content appears in the plain coalesced body
        boolean plainBodyContainsTaskPlain = body1.contains("task-plain") || body2.contains("task-plain");
        assertTrue(plainBodyContainsTaskPlain, "plain body must contain task-plain: body1=" + body1 + " body2=" + body2);

        assertEquals(0, pendingStore.size(), "pending should be fully drained");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 3: approval item only, send fails → item re-enqueued
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_approvalSendFailure_reEnqueues() throws Exception {
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath();
                if (path != null && path.contains("getAppAccessToken")) {
                    return new MockResponse()
                            .setBody("{\"access_token\":\"tok\",\"expires_in\":7200}")
                            .addHeader("Content-Type", "application/json");
                }
                return new MockResponse().setResponseCode(500);
            }
        });

        PassiveWindow window = openid -> null;
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "fail-task";
        ap.answer = "needs approval";
        ap.ts = System.currentTimeMillis();
        ap.approvalId = "run-fail#3";
        pendingStore.enqueue(ap);

        int delivered = adapter.flush("FAIL_MSG_ID");

        // Approval send failed so nothing delivered; approval was re-enqueued
        assertEquals(0, delivered, "approval send failed, nothing delivered");
        assertEquals(1, pendingStore.size(), "failed approval item should be re-enqueued");

        QqPendingStore.Pending requeued = pendingStore.drainAll().get(0);
        assertEquals("run-fail#3", requeued.approvalId, "re-enqueued item must preserve approvalId");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 4: only plain items → original coalescing behavior unchanged
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void flush_onlyPlainItems_coalescesBehaviorUnchanged() throws Exception {
        PassiveWindow window = openid -> null;
        QqDeliveryAdapter adapter = new QqDeliveryAdapter(OWNER_OPENID, api, pendingStore, window);

        QqPendingStore.Pending p1 = new QqPendingStore.Pending();
        p1.taskName = "alpha"; p1.answer = "Alpha result"; p1.ts = System.currentTimeMillis();
        pendingStore.enqueue(p1);

        QqPendingStore.Pending p2 = new QqPendingStore.Pending();
        p2.taskName = "beta"; p2.answer = "Beta result"; p2.ts = System.currentTimeMillis();
        pendingStore.enqueue(p2);

        int delivered = adapter.flush("PLAIN_FLUSH_ID");
        assertEquals(2, delivered, "2 plain items delivered (coalesced)");

        RecordedRequest req = drainUntilMessages();
        assertNotNull(req, "exactly one coalesced message expected");
        String body = req.getBody().readUtf8();
        // Verify alpha/beta content in the request body
        assertTrue(body.contains("alpha") && body.contains("beta"), "body must contain both alpha and beta: " + body);
        // Plain coalesced message uses msg_type=0 (sendC2C)
        assertTrue(body.contains("\"msg_type\":0"), "plain message must use msg_type=0: " + body);

        // No second messages request
        RecordedRequest extra = server.takeRequest(200, TimeUnit.MILLISECONDS);
        if (extra != null && extra.getPath() != null && extra.getPath().contains("/messages")) {
            fail("plain flush sent more than one /messages request");
        }

        assertEquals(0, pendingStore.size(), "pending should be fully drained after plain flush");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper
    // ─────────────────────────────────────────────────────────────────────────

    private RecordedRequest drainUntilMessages() throws InterruptedException {
        for (int i = 0; i < 5; i++) {
            RecordedRequest r = server.takeRequest(1, TimeUnit.SECONDS);
            if (r == null) break;
            if (r.getPath() != null && r.getPath().contains("/messages")) return r;
        }
        return null;
    }
}
