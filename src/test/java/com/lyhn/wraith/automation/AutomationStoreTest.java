package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
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

    /**
     * 跨层回归：桌面 TypeScript 产生的 automations.json 用小写 kind（"interval"/"cron"）——
     * daemon AutomationStore.loadTasks() 必须能正确反序列化，否则 daemon 读不出任何任务。
     * 这是修 ScheduleKind uppercase-wire bug 的守护测试。
     */
    @Test void loadTasks_lowercaseKindFromDesktop_deserializesCorrectly() throws Exception {
        // 完全模拟桌面写出的 automations.json（lowercase kind，与 TS AutomationSchedule 一致）
        String json = "{\"tasks\":["
                + "{\"id\":\"t-interval\",\"name\":\"interval task\",\"prompt\":\"ping\","
                + "\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"interval\",\"everyMinutes\":1},"
                + "\"enabled\":true,\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},"
                + "\"createdAt\":0,\"enabledAt\":0},"
                + "{\"id\":\"t-cron\",\"name\":\"cron task\",\"prompt\":\"report\","
                + "\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"cron\",\"expr\":\"0 9 * * 1-5\"},"
                + "\"enabled\":true,\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},"
                + "\"createdAt\":0,\"enabledAt\":0}"
                + "]}";
        Files.write(dir.resolve("automations.json"), json.getBytes());

        List<AutomationTask> tasks = new AutomationStore(dir).loadTasks();
        assertEquals(2, tasks.size(), "桌面小写 kind 的任务应全部加载");

        AutomationTask interval = tasks.stream()
                .filter(t -> "t-interval".equals(t.id)).findFirst()
                .orElseThrow(() -> new AssertionError("t-interval not found"));
        assertEquals(ScheduleKind.INTERVAL, interval.schedule.kind,
                "\"interval\" 应反序列化为 ScheduleKind.INTERVAL");
        assertEquals(1, interval.schedule.everyMinutes);

        AutomationTask cron = tasks.stream()
                .filter(t -> "t-cron".equals(t.id)).findFirst()
                .orElseThrow(() -> new AssertionError("t-cron not found"));
        assertEquals(ScheduleKind.CRON, cron.schedule.kind,
                "\"cron\" 应反序列化为 ScheduleKind.CRON");
        assertEquals("0 9 * * 1-5", cron.schedule.expr);
    }
}
