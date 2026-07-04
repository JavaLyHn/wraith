package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRun;
import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TDD test for DesktopDeliveryAdapter.
 *
 * <p>Uses a real AutomationStore on a JUnit @TempDir — no mocks needed.
 */
class DesktopDeliveryAdapterTest {

    @TempDir
    Path tmpDir;

    // ─────────────────────────────────────────────────────────────────────────
    // Case 1: sessionId match → mark that run notifyDesktop=true
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void deliver_bySessionId_marksNotifyDesktop() {
        AutomationStore store = new AutomationStore(tmpDir);

        // Pre-write a run with a known sessionId
        AutomationRun run = new AutomationRun();
        run.runId = "run-1";
        run.taskId = "t1";
        run.sessionId = "s1";
        run.startedAt = 1_000L;
        run.status = "success";
        run.notifyDesktop = false;
        store.putRun(run);

        AutomationTask task = new AutomationTask();
        task.id = "t1";
        task.name = "daily";

        DeliveryTarget target = new DeliveryTarget();
        target.platform = "desktop";

        AutomationRunner.RunResult result =
                new AutomationRunner.RunResult("success", "done", "s1", List.of());

        DesktopDeliveryAdapter adapter = new DesktopDeliveryAdapter(store);
        adapter.deliver(target, task, result);

        // Reload and assert
        List<AutomationRun> runs = store.loadRuns();
        assertEquals(1, runs.size());
        assertTrue(runs.get(0).notifyDesktop, "notifyDesktop should be true after deliver");
        assertEquals("run-1", runs.get(0).runId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 2: sessionId==null → fallback to most-recent run for taskId
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void deliver_nullSessionId_fallsBackToMostRecentRunForTask() {
        AutomationStore store = new AutomationStore(tmpDir);

        // Pre-write an older run for t2
        AutomationRun older = new AutomationRun();
        older.runId = "run-old";
        older.taskId = "t2";
        older.sessionId = null;
        older.startedAt = 500L;
        older.status = "failed";
        older.notifyDesktop = false;
        store.putRun(older);

        // Pre-write the newest run for t2
        AutomationRun newest = new AutomationRun();
        newest.runId = "run-new";
        newest.taskId = "t2";
        newest.sessionId = null;
        newest.startedAt = 2_000L;
        newest.status = "failed";
        newest.notifyDesktop = false;
        store.putRun(newest);

        AutomationTask task = new AutomationTask();
        task.id = "t2";
        task.name = "nightly";

        DeliveryTarget target = new DeliveryTarget();
        target.platform = "desktop";

        // RunResult with null sessionId
        AutomationRunner.RunResult result =
                new AutomationRunner.RunResult("failed", "err", null, List.of());

        DesktopDeliveryAdapter adapter = new DesktopDeliveryAdapter(store);
        adapter.deliver(target, task, result);

        // The most-recent run (startedAt=2000) should be marked; older should not
        List<AutomationRun> runs = store.loadRuns();
        AutomationRun markedRun = runs.stream()
                .filter(r -> "run-new".equals(r.runId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("run-new not found"));
        AutomationRun olderRun = runs.stream()
                .filter(r -> "run-old".equals(r.runId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("run-old not found"));

        assertTrue(markedRun.notifyDesktop, "most-recent run for t2 should be marked notifyDesktop=true");
        assertFalse(olderRun.notifyDesktop, "older run for t2 should NOT be marked");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Case 3: no run found → should NOT throw (just log warn + return)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    void deliver_noRunFound_doesNotThrow() {
        AutomationStore store = new AutomationStore(tmpDir);  // empty store

        AutomationTask task = new AutomationTask();
        task.id = "t-missing";
        task.name = "ghost";

        DeliveryTarget target = new DeliveryTarget();
        target.platform = "desktop";

        AutomationRunner.RunResult result =
                new AutomationRunner.RunResult("failed", "err", "s-missing", List.of());

        DesktopDeliveryAdapter adapter = new DesktopDeliveryAdapter(store);

        // Must not throw
        assertDoesNotThrow(() -> adapter.deliver(target, task, result));
    }
}
