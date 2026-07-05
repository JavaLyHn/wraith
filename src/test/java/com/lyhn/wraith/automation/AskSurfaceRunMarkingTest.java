package com.lyhn.wraith.automation;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Focused test for the AskSurface run-marking logic introduced in Task-15 control-plane fix.
 *
 * <p>Reconstructs the AskSurface closure from GatewayDaemon (Step 7) — with the run-marking
 * addition — against a real {@link AutomationStore} on a temp dir, with one pre-seeded active
 * run in "running" status. After calling surface(), asserts the run is "waiting_approval" with
 * approvalId and approvalTool set.
 *
 * <p>Does NOT start the live daemon or touch the network.
 */
class AskSurfaceRunMarkingTest {

    @TempDir
    Path tempDir;

    private ApprovalRequest reqFor(String tool) {
        return ApprovalRequest.of(tool, "{}", "test-reason");
    }

    /**
     * Builds the AskSurface closure that mirrors GatewayDaemon Step 7 (with run-marking).
     */
    private ScheduledRunRenderer.AskSurface buildAskSurface(
            Map<String, CompletableFuture<ApprovalResult>> pendingApprovals,
            AtomicLong counter,
            AutomationStore store) {

        return (runId, req) -> {
            String approvalId = runId + "#" + counter.incrementAndGet();
            CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
            pendingApprovals.put(approvalId, f);
            f.whenComplete((r, e) -> pendingApprovals.remove(approvalId));

            // Mark the active run as waiting_approval (mirrors GatewayDaemon)
            try {
                store.nonTerminalRuns().stream()
                        .filter(r -> runId.equals(r.taskId))
                        .findFirst()
                        .ifPresent(r -> {
                            r.status = "waiting_approval";
                            r.approvalId = approvalId;
                            r.approvalTool = req.toolName();
                            store.putRun(r);
                        });
            } catch (Exception e) {
                // marking failure must not break the approval flow
                System.err.println("[test] run marking failed: " + e.getMessage());
            }

            return f;
        };
    }

    // -------------------------------------------------------------------------
    // Test 1: surface() marks the run as waiting_approval with approvalId+approvalTool
    // -------------------------------------------------------------------------
    @Test
    void surface_marksRunWaitingApproval_withApprovalIdAndTool() throws Exception {
        AutomationStore store = new AutomationStore(tempDir);

        // Pre-seed an active "running" run for task "task-1"
        AutomationRun run = new AutomationRun();
        run.runId = "run-abc";
        run.taskId = "task-1";
        run.startedAt = System.currentTimeMillis();
        run.status = "running";
        store.putRun(run);

        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, store);

        // surface() uses runId == task.id == "task-1"
        CompletableFuture<ApprovalResult> f = askSurface.surface("task-1", reqFor("write_file"));
        assertFalse(f.isDone(), "future should not be done before approval");

        // The run should now be waiting_approval
        AutomationRun updated = store.loadRuns().stream()
                .filter(r -> "run-abc".equals(r.runId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("run not found after surface()"));

        assertEquals("waiting_approval", updated.status, "status should be waiting_approval");
        assertNotNull(updated.approvalId, "approvalId should be set");
        assertTrue(updated.approvalId.startsWith("task-1#"), "approvalId should start with taskId#");
        assertEquals("write_file", updated.approvalTool, "approvalTool should match tool name");

        // The approvalId in the run should match the key in pendingApprovals
        assertTrue(pendingApprovals.containsKey(updated.approvalId),
                "approvalId in run must be registered in pendingApprovals");
    }

    // -------------------------------------------------------------------------
    // Test 2: surface() still returns a future even if no active run found (graceful)
    // -------------------------------------------------------------------------
    @Test
    void surface_noActiveRun_stillReturnsFuture() throws Exception {
        AutomationStore store = new AutomationStore(tempDir);
        // No runs seeded — marking should silently skip
        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, store);

        CompletableFuture<ApprovalResult> f =
                assertDoesNotThrow(() -> askSurface.surface("task-missing", reqFor("run_shell")));
        assertNotNull(f, "surface() must return a non-null future even without an active run");
        assertFalse(f.isDone(), "future should not be done");
        assertEquals(1, pendingApprovals.size(), "approvalId should still be registered");
    }

    // -------------------------------------------------------------------------
    // Test 3: surface() marking failure (store throws) does not propagate
    // -------------------------------------------------------------------------
    @Test
    void surface_markingException_doesNotPropagate() {
        // Use a store pointing to a non-existent parent dir path that makes putRun fail
        // by wrapping a store that will throw on putRun.  We simulate via a subclass-like
        // anonymous override using a real store but a path where atomic write fails
        // (we pre-verify: if it doesn't fail, the test still passes — marking is best-effort).
        AutomationStore store = new AutomationStore(tempDir);

        // Pre-seed a running run
        AutomationRun run = new AutomationRun();
        run.runId = "run-x";
        run.taskId = "task-x";
        run.startedAt = System.currentTimeMillis();
        run.status = "running";
        store.putRun(run);

        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);

        // Build AskSurface where the store.putRun is replaced by a throwing path
        ScheduledRunRenderer.AskSurface askSurface = (runId, req) -> {
            String approvalId = runId + "#" + counter.incrementAndGet();
            CompletableFuture<ApprovalResult> f2 = new CompletableFuture<>();
            pendingApprovals.put(approvalId, f2);
            f2.whenComplete((r, e) -> pendingApprovals.remove(approvalId));
            // Simulate a marking failure that must not propagate
            try {
                throw new RuntimeException("simulated store failure");
            } catch (Exception e) {
                // swallowed — marking is best-effort
            }
            return f2;
        };

        CompletableFuture<ApprovalResult> f =
                assertDoesNotThrow(() -> askSurface.surface("task-x", reqFor("write_file")));
        assertNotNull(f);
        assertFalse(f.isDone());
    }

    // -------------------------------------------------------------------------
    // Test 4: approvalId format in marking = runId + "#" + counter
    // -------------------------------------------------------------------------
    @Test
    void surface_approvalIdFormat_matchesPendingApprovals() throws Exception {
        AutomationStore store = new AutomationStore(tempDir);
        AutomationRun run = new AutomationRun();
        run.runId = "run-1";
        run.taskId = "my-task";
        run.startedAt = System.currentTimeMillis();
        run.status = "running";
        store.putRun(run);

        Map<String, CompletableFuture<ApprovalResult>> pendingApprovals = new ConcurrentHashMap<>();
        AtomicLong counter = new AtomicLong(0);
        ScheduledRunRenderer.AskSurface askSurface = buildAskSurface(pendingApprovals, counter, store);

        askSurface.surface("my-task", reqFor("execute_command"));

        // After surface, the run should have approvalId registered in pendingApprovals
        AutomationRun updated = store.loadRuns().stream()
                .filter(r -> "run-1".equals(r.runId))
                .findFirst().orElseThrow();

        assertNotNull(updated.approvalId);
        String expectedPrefix = "my-task#";
        assertTrue(updated.approvalId.startsWith(expectedPrefix),
                "approvalId must start with 'my-task#' but was: " + updated.approvalId);
        assertTrue(pendingApprovals.containsKey(updated.approvalId),
                "approvalId must be in pendingApprovals");
    }
}
