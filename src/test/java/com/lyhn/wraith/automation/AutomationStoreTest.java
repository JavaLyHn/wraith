package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AutomationStoreTest {
    @TempDir Path dir;

    @Test void loadTasksEmptyWhenMissing() {
        assertTrue(new AutomationStore(dir).loadTasks().isEmpty());
    }

    @Test void stateRoundTripsAndIsIsolatedFromDefs() {
        AutomationStore s = new AutomationStore(dir);
        assertNull(s.lastFiredAt("t1"));
        s.setLastFiredAt("t1", 123L);
        assertEquals(123L, s.lastFiredAt("t1"));
        // 新实例仍读得到(落盘)
        assertEquals(123L, new AutomationStore(dir).lastFiredAt("t1"));
    }

    @Test void putRunKeepsLast50PerTask() {
        AutomationStore s = new AutomationStore(dir);
        for (int i = 0; i < 60; i++) {
            AutomationRun r = new AutomationRun();
            r.runId = "r" + i; r.taskId = "t1"; r.startedAt = i; r.status = "success";
            s.putRun(r);
        }
        List<AutomationRun> runs = s.loadRuns();
        assertEquals(50, runs.stream().filter(r -> r.taskId.equals("t1")).count());
    }

    @Test void nonTerminalRunsFiltered() {
        AutomationStore s = new AutomationStore(dir);
        AutomationRun a = new AutomationRun(); a.runId="a"; a.taskId="t"; a.status="running";
        AutomationRun b = new AutomationRun(); b.runId="b"; b.taskId="t"; b.status="success";
        s.putRun(a); s.putRun(b);
        List<AutomationRun> nt = s.nonTerminalRuns();
        assertEquals(1, nt.size());
        assertEquals("a", nt.get(0).runId);
    }
}
