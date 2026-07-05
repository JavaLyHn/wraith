package com.lyhn.wraith.automation;

import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for Task-14: ask-surfacing resolution mechanics.
 *
 * <p>Reconstructs the resolution logic from GatewayDaemon in isolation so we can
 * test it without starting the live daemon (which would conflict with the real QQ WS).
 *
 * <p>Three scenarios tested:
 * <ol>
 *   <li>QQ resolve: surface → simulate button-tap by completing future from pendingApprovals
 *       → assert future/renderer sees APPROVED; also assert REJECTED on timeout.</li>
 *   <li>Desktop resolve: drop an approval request file → RequestInbox.drain() → complete
 *       future with reject → assert future/renderer sees REJECTED.</li>
 *   <li>Coexistence: a scheduled approvalId is resolved via pendingApprovals without
 *       also routing to the IM-session driver.</li>
 * </ol>
 */
class AskSurfaceResolutionTest {

    @TempDir
    Path tempDir;

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers — reproduce the AskSurface closure from GatewayDaemon
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Builds the real AskSurface closure (mirrors GatewayDaemon Step 7) over the
     * given pendingApprovals map and an optional QQ pending-enqueue sink.
     */
    private ScheduledRunRenderer.AskSurface buildAskSurface(
            Map<String, CompletableFuture<ApprovalResult>> pendingApprovals,
            AtomicLong counter,
            QqPendingStore qqPending) {

        return (runId, req) -> {
            String approvalId = runId + "#" + counter.incrementAndGet();
            CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
            pendingApprovals.put(approvalId, f);

            if (qqPending != null) {
                QqPendingStore.Pending ap = new QqPendingStore.Pending();
                ap.taskName = req.toolName();
                ap.answer = req.suggestion() != null ? req.suggestion() : "定时任务审批";
                ap.ts = System.currentTimeMillis();
                ap.approvalId = approvalId;
                qqPending.enqueue(ap);
            }
            return f;
        };
    }

    private ApprovalRequest reqFor(String tool) {
        return ApprovalRequest.of(tool, "{}", "test-reason");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QQ resolve — approve path
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void qqResolve_approve_futureCompletesApproved() throws Exception {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);
        QqPendingStore qqPending = new QqPendingStore(tempDir);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, qqPending);

        // surface → future registered
        String runId = "run-42";
        CompletableFuture<ApprovalResult> f = askSurface.surface(runId, reqFor("write_file"));
        assertFalse(f.isDone(), "future should not be done before button tap");

        // QQ pending should have one approval item
        assertEquals(1, qqPending.size(), "one approval item enqueued in QQ pending store");
        QqPendingStore.Pending queued = qqPending.drainAll().get(0);
        assertNotNull(queued.approvalId, "approvalId must be non-null on approval-pending item");
        assertTrue(queued.approvalId.startsWith(runId + "#"), "approvalId should start with runId#");

        // Simulate onInteraction button tap: look up approvalId in pendingApprovals
        String approvalId = queued.approvalId;
        assertTrue(pendingApprovals.containsKey(approvalId), "approvalId must be registered in pendingApprovals");

        CompletableFuture<ApprovalResult> registered = pendingApprovals.remove(approvalId);
        assertNotNull(registered, "future must be retrievable from pendingApprovals");
        registered.complete(ApprovalResult.approve());

        // Now the original future should be resolved
        assertTrue(f.isDone(), "future should be done after button tap");
        ApprovalResult result = f.get(100, TimeUnit.MILLISECONDS);
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision(), "button-tap approve → APPROVED");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QQ resolve — renderer integration: approve via future, reject via timeout
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void qqResolve_rendererApprove_afterButtonTap() throws Exception {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, null);

        ApprovalPolicy policy = new ApprovalPolicy();
        policy.default_ = ApprovalMode.ASK;
        // Long enough for the simulated tap but finite
        ScheduledRunRenderer renderer = new ScheduledRunRenderer(policy, 3000, askSurface);
        renderer.setRunId("run-renderer-1");

        // Tap the button on a separate thread after a short delay
        AtomicReference<String> capturedApprovalId = new AtomicReference<>();
        CountDownLatch surfaced = new CountDownLatch(1);

        // Wrap askSurface to capture approvalId
        ScheduledRunRenderer.AskSurface wrapping = (runId, req) -> {
            CompletableFuture<ApprovalResult> f = askSurface.surface(runId, req);
            // At this point the approvalId is the only key in the map
            pendingApprovals.keySet().stream().findFirst().ifPresent(k -> {
                capturedApprovalId.set(k);
                surfaced.countDown();
            });
            return f;
        };

        ScheduledRunRenderer renderer2 = new ScheduledRunRenderer(policy, 3000, wrapping);
        renderer2.setRunId("run-renderer-2");

        ExecutorService worker = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> rendererFuture = worker.submit(
                () -> renderer2.promptApproval(reqFor("write_file")));

        // Wait until surface() has been called and approvalId captured
        assertTrue(surfaced.await(2, TimeUnit.SECONDS), "surface() should be called within 2s");

        // Now simulate the button tap on the main thread
        String approvalId = capturedApprovalId.get();
        assertNotNull(approvalId);
        CompletableFuture<ApprovalResult> f = pendingApprovals.remove(approvalId);
        assertNotNull(f);
        f.complete(ApprovalResult.approve());

        ApprovalResult result = rendererFuture.get(2, TimeUnit.SECONDS);
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision(), "renderer should return APPROVED after tap");
        worker.shutdownNow();
    }

    @Test
    void qqResolve_rendererRejectsOnTimeout() {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        // Never-completing future — timeout triggers REJECTED
        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, null);

        ApprovalPolicy policy = new ApprovalPolicy();
        policy.default_ = ApprovalMode.ASK;
        ScheduledRunRenderer renderer = new ScheduledRunRenderer(policy, 150, askSurface);
        renderer.setRunId("run-timeout");

        ApprovalResult result = renderer.promptApproval(reqFor("write_file"));
        assertEquals(ApprovalResult.Decision.REJECTED, result.decision(), "timeout → REJECTED");
        assertTrue(renderer.deniedTools().contains("write_file"), "timed-out tool recorded in deniedTools");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Desktop resolve — via RequestInbox
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void desktopResolve_reject_viaRequestInbox() throws Exception {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, null);

        CompletableFuture<ApprovalResult> f = askSurface.surface("run-desktop-1", reqFor("execute_command"));
        assertFalse(f.isDone());

        // Recover approvalId (the only key in the map)
        String approvalId = pendingApprovals.keySet().iterator().next();

        // Write a rejection approval request file into the inbox directory
        Path inboxDir = tempDir.resolve("automation-requests");
        Files.createDirectories(inboxDir);
        String json = String.format("{\"type\":\"approval\",\"id\":\"%s\",\"payload\":\"reject\"}", approvalId);
        Files.writeString(inboxDir.resolve("req-" + approvalId + ".json"), json, StandardCharsets.UTF_8);

        // RequestInbox.drain() reads and deletes the file
        RequestInbox inbox = new RequestInbox(inboxDir);
        for (RequestInbox.Request r : inbox.drain()) {
            if ("approval".equals(r.type())) {
                CompletableFuture<ApprovalResult> fut = pendingApprovals.remove(r.id());
                if (fut != null) {
                    fut.complete("approve".equals(r.payload())
                            ? ApprovalResult.approve()
                            : ApprovalResult.reject("desktop rejected"));
                }
            }
        }

        assertTrue(f.isDone(), "future should be completed by inbox drain");
        ApprovalResult result = f.get(100, TimeUnit.MILLISECONDS);
        assertEquals(ApprovalResult.Decision.REJECTED, result.decision(), "desktop reject → REJECTED");
        assertEquals("desktop rejected", result.reason(), "rejection reason must match");
    }

    @Test
    void desktopResolve_runNow_routesToScheduler() throws Exception {
        // Verify inbox draining with run-now type — scheduler.requestRunNow is
        // called; we mock it with a captured flag.
        Path inboxDir = tempDir.resolve("automation-requests");
        Files.createDirectories(inboxDir);
        String json = "{\"type\":\"run-now\",\"id\":\"task-abc\",\"payload\":null}";
        Files.writeString(inboxDir.resolve("run-now-1.json"), json, StandardCharsets.UTF_8);

        AtomicReference<String> capturedTaskId = new AtomicReference<>();
        RequestInbox inbox = new RequestInbox(inboxDir);
        for (RequestInbox.Request r : inbox.drain()) {
            if ("run-now".equals(r.type())) {
                capturedTaskId.set(r.id()); // simulates sch.requestRunNow(r.id())
            }
        }

        assertEquals("task-abc", capturedTaskId.get(), "run-now id must be passed to scheduler");
        // File should be deleted after drain
        assertFalse(Files.exists(inboxDir.resolve("run-now-1.json")), "request file must be deleted after drain");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ApprovalId uniqueness — AtomicLong, not random
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void approvalIdIsUnique_andUsesCounter() throws Exception {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, null);

        askSurface.surface("r1", reqFor("write_file"));
        askSurface.surface("r2", reqFor("execute_command"));
        askSurface.surface("r1", reqFor("write_file")); // same runId but different counter

        assertEquals(3, pendingApprovals.size(), "three distinct approvalIds must be registered");
        // All keys must contain '#' separating runId from counter
        for (String key : pendingApprovals.keySet()) {
            assertTrue(key.contains("#"), "approvalId must contain '#': " + key);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Coexistence: scheduled vs IM-session approvals (onInteraction branch logic)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void onInteraction_scheduledApproval_doesNotRouteToDriver() {
        // Reconstruct the onInteraction branch logic from GatewayDaemon.
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, null);

        // Surface one scheduled approval
        CompletableFuture<ApprovalResult> scheduledFuture;
        try {
            scheduledFuture = askSurface.surface("sched-run-1", reqFor("write_file"));
        } catch (Exception e) {
            throw new AssertionError("surface should not throw", e);
        }
        String approvalId = pendingApprovals.keySet().iterator().next();

        // Track whether driver.onApproval was called
        AtomicReference<String> driverCalledWith = new AtomicReference<>(null);

        // Simulate onInteraction body: parse buttonData → check pendingApprovals first
        String buttonData = "approve:" + approvalId + ":allow-once";
        String[] p = buttonData.split(":", 3);
        assertTrue("approve".equals(p[0]), "button data must start with 'approve'");
        String sessionKey = p[1];

        boolean isScheduledApproval = pendingApprovals.containsKey(sessionKey);
        if (isScheduledApproval) {
            CompletableFuture<ApprovalResult> f = pendingApprovals.remove(sessionKey);
            if (f != null) {
                f.complete(ApprovalResult.approve());
            }
            // RETURN — do not call driver.onApproval
        } else {
            driverCalledWith.set(sessionKey); // simulates driver.onApproval(...)
        }

        // Scheduled future should be resolved
        assertTrue(scheduledFuture.isDone(), "scheduled future should be completed");
        assertEquals(ApprovalResult.Decision.APPROVED, scheduledFuture.getNow(null).decision());

        // Driver should NOT have been called
        assertNull(driverCalledWith.get(), "driver.onApproval must NOT be called for scheduled approvals");
    }

    @Test
    void onInteraction_imSessionApproval_routesToDriver_notScheduled() {
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();

        // Simulate onInteraction with a sessionKey that is NOT in pendingApprovals
        String imSessionKey = "im-session-key-xyz";
        String buttonData = "approve:" + imSessionKey + ":allow-once";
        String[] p = buttonData.split(":", 3);
        String sessionKey = p[1];

        AtomicReference<String> driverCalledWith = new AtomicReference<>(null);

        boolean isScheduledApproval = pendingApprovals.containsKey(sessionKey);
        if (isScheduledApproval) {
            pendingApprovals.remove(sessionKey).complete(ApprovalResult.approve());
        } else {
            driverCalledWith.set(sessionKey); // simulates driver.onApproval(...)
        }

        assertEquals(imSessionKey, driverCalledWith.get(),
                "IM-session approval must be routed to driver.onApproval");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QqPendingStore.Pending.approvalId is preserved through persist/load cycle
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void pendingStore_approvalId_survivesRoundtrip() {
        QqPendingStore store = new QqPendingStore(tempDir);

        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "daily-backup";
        ap.answer = "approval needed";
        ap.ts = System.currentTimeMillis();
        ap.approvalId = "run-123#7";
        store.enqueue(ap);

        // Also enqueue a plain delivery
        QqPendingStore.Pending plain = new QqPendingStore.Pending();
        plain.taskName = "report";
        plain.answer = "all good";
        plain.ts = System.currentTimeMillis();
        plain.approvalId = null;
        store.enqueue(plain);

        java.util.List<QqPendingStore.Pending> loaded = store.drainAll();
        assertEquals(2, loaded.size());

        QqPendingStore.Pending loadedAp = loaded.stream()
                .filter(x -> x.approvalId != null).findFirst()
                .orElseThrow(() -> new AssertionError("approval pending item not found"));
        assertEquals("run-123#7", loadedAp.approvalId, "approvalId must survive JSON round-trip");
        assertEquals("daily-backup", loadedAp.taskName);

        QqPendingStore.Pending loadedPlain = loaded.stream()
                .filter(x -> x.approvalId == null).findFirst()
                .orElseThrow(() -> new AssertionError("plain pending item not found"));
        assertNull(loadedPlain.approvalId, "plain item approvalId must remain null");
    }
}
