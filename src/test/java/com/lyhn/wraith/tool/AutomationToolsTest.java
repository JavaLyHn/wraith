package com.lyhn.wraith.tool;

import com.lyhn.wraith.automation.AutomationStore;
import com.lyhn.wraith.automation.ScheduleKind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class AutomationToolsTest {

    @TempDir Path tmp;
    private String old;

    @BeforeEach
    void redirectDir() {
        old = System.getProperty("wraith.automation.dir");
        System.setProperty("wraith.automation.dir", tmp.toString());
    }

    @AfterEach
    void restoreDir() {
        if (old == null) System.clearProperty("wraith.automation.dir");
        else System.setProperty("wraith.automation.dir", old);
    }

    @Test
    void upsertCronThenListThenRemove() {
        ToolRegistry reg = new ToolRegistry();
        String created = reg.executeTool("automation_upsert",
                "{\"name\":\"每日巡检\",\"prompt\":\"跑一遍测试\",\"cron\":\"0 9 * * *\"}");
        assertFalse(created.startsWith("automation_upsert 失败"), created);

        var tasks = AutomationStore.openDefault().loadTasks();
        assertEquals(1, tasks.size());
        assertEquals("每日巡检", tasks.get(0).name);
        assertEquals(ScheduleKind.CRON, tasks.get(0).schedule.kind);
        assertEquals("0 9 * * *", tasks.get(0).schedule.expr);
        assertTrue(tasks.get(0).enabled);
        assertTrue(tasks.get(0).createdAt > 0);
        String id = tasks.get(0).id;
        assertTrue(created.contains(id), "成功串应含任务 id: " + created);

        String listed = reg.executeTool("automation_list", "{}");
        assertTrue(listed.contains("每日巡检"), listed);

        String removed = reg.executeTool("automation_remove", "{\"id\":\"" + id + "\"}");
        assertFalse(removed.startsWith("automation_remove 失败"), removed);
        assertTrue(AutomationStore.openDefault().loadTasks().isEmpty());
    }

    @Test
    void upsertRejectsInvalidCron() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("automation_upsert",
                "{\"name\":\"坏\",\"prompt\":\"x\",\"cron\":\"不是 cron\"}");
        assertTrue(out.startsWith("automation_upsert 失败"), out);
        assertTrue(AutomationStore.openDefault().loadTasks().isEmpty(), "非法 cron 不得落盘");
    }

    @Test
    void upsertSupportsIntervalAndDaily() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.executeTool("automation_upsert",
                "{\"name\":\"间隔\",\"prompt\":\"x\",\"every_minutes\":30}").startsWith("automation_upsert 失败"));
        assertFalse(reg.executeTool("automation_upsert",
                "{\"name\":\"每天\",\"prompt\":\"x\",\"daily_time\":\"08:30\"}").startsWith("automation_upsert 失败"));
        var kinds = AutomationStore.openDefault().loadTasks().stream().map(t -> t.schedule.kind).toList();
        assertTrue(kinds.contains(ScheduleKind.INTERVAL), kinds.toString());
        assertTrue(kinds.contains(ScheduleKind.DAILY), kinds.toString());
    }

    @Test
    void upsertRequiresNamePromptAndExactlyOneSchedule() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("automation_upsert", "{\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}")
                .startsWith("automation_upsert 失败"));
        assertTrue(reg.executeTool("automation_upsert", "{\"name\":\"n\",\"cron\":\"0 9 * * *\"}")
                .startsWith("automation_upsert 失败"));
        assertTrue(reg.executeTool("automation_upsert", "{\"name\":\"n\",\"prompt\":\"x\"}")
                .startsWith("automation_upsert 失败"), "无 schedule 应失败");
        assertTrue(reg.executeTool("automation_upsert",
                "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\",\"every_minutes\":5}")
                .startsWith("automation_upsert 失败"), "多个 schedule 应失败");
    }

    @Test
    void upsertWithExistingIdUpdatesInPlaceAndKeepsCreatedAt() {
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"原名\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        var before = AutomationStore.openDefault().loadTasks().get(0);
        String out = reg.executeTool("automation_upsert",
                "{\"id\":\"" + before.id + "\",\"name\":\"改名\",\"prompt\":\"y\",\"cron\":\"0 10 * * *\"}");
        assertFalse(out.startsWith("automation_upsert 失败"), out);
        var after = AutomationStore.openDefault().loadTasks();
        assertEquals(1, after.size(), "同 id 应就地更新而非新增");
        assertEquals("改名", after.get(0).name);
        assertEquals(before.createdAt, after.get(0).createdAt, "createdAt 应保留");
    }

    @Test
    void removeAndRunNowRejectUnknownId() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("automation_remove", "{\"id\":\"no-such\"}").startsWith("automation_remove 失败"));
        assertTrue(reg.executeTool("automation_run_now", "{\"id\":\"no-such\"}").startsWith("automation_run_now 失败"));
    }

    @Test
    void runNowReportsFailureWhenDaemonNotRunning() throws Exception {
        // 旧断言是「不算失败 + 提一句需要守护进程」。真机推翻:守护进程没运行时请求只会
        // 永远躺在 inbox 里,用户以为跑了实际没跑,而网关下次启动它又会凭空执行。
        // 现在必须如实报失败,并且不留下请求文件。
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        String id = AutomationStore.openDefault().loadTasks().get(0).id;
        String out = reg.executeTool("automation_run_now", "{\"id\":\"" + id + "\"}");
        assertTrue(out.startsWith("automation_run_now 失败"), "无守护进程时必须报失败,实际: " + out);
        assertTrue(out.contains("未运行"), "要说清原因,实际: " + out);
        assertTrue(out.contains("撤回"), "要说明请求已撤回、不会补跑,实际: " + out);

        java.nio.file.Path reqDir = AutomationStore.defaultRequestsDir();
        if (java.nio.file.Files.isDirectory(reqDir)) {
            try (var st = java.nio.file.Files.list(reqDir)) {
                assertEquals(0, st.filter(f -> f.toString().endsWith(".json")).count(),
                        "请求必须被回收,否则网关启动后任务会凭空跑起来");
            }
        }
    }

    @Test
    void runNowSucceedsWhenSomeoneConsumesTheRequest() throws Exception {
        // 有活着的消费者(真实场景=gateway daemon)时应报成功。
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"n2\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        String id = AutomationStore.openDefault().loadTasks().get(0).id;
        java.nio.file.Path reqDir = AutomationStore.defaultRequestsDir();
        Thread fakeDaemon = new Thread(() -> {
            for (int i = 0; i < 300; i++) {
                if (!new com.lyhn.wraith.automation.RequestInbox(reqDir).drain().isEmpty()) return;
                try { Thread.sleep(10); } catch (InterruptedException e) { return; }
            }
        });
        fakeDaemon.setDaemon(true);
        fakeDaemon.start();

        String out = reg.executeTool("automation_run_now", "{\"id\":\"" + id + "\"}");
        fakeDaemon.join(5000);
        assertFalse(out.startsWith("automation_run_now 失败"), out);
        assertTrue(out.contains("交给守护进程"), out);
    }

    @Test
    void runsListingWorksOnEmptyStore() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.executeTool("automation_runs", "{}").startsWith("automation_runs 失败"));
    }

    @Test
    void runsListingSortsByStartedAtDescendingNotDiskOrder() {
        var store = AutomationStore.openDefault();
        long base = 1_700_000_000_000L;
        // 故意乱序写入(且每条 run 用不同 taskId,踩中 putRun 按 taskId groupingBy(HashMap)
        // 分组、组间顺序与时间无关的真实实现),证明输出顺序不是"写入顺序"也不是"磁盘顺序",
        // 而是真的按 startedAt 倒序——不排序时,10 个不同 taskId 的分组顺序几乎不可能巧合地
        // 恰好等于时间倒序(概率 1/10!)。
        int[] writeOrder = {3, 7, 1, 9, 0, 5, 2, 8, 4, 6};
        for (int i : writeOrder) {
            var run = new com.lyhn.wraith.automation.AutomationRun();
            run.runId = "run-" + i;
            run.taskId = "task-" + i;
            run.startedAt = base + i * 100_000L;
            run.status = "success";
            store.putRun(run);
        }

        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("automation_runs", "{\"limit\":10}");

        int previousIndex = -1;
        for (int i = 9; i >= 0; i--) {
            int idx = out.indexOf("run-" + i + " ");
            assertTrue(idx >= 0, "缺少 run-" + i + ": " + out);
            assertTrue(idx > previousIndex, "run-" + i + " (更新) 应比更旧的记录先出现: " + out);
            previousIndex = idx;
        }
        assertTrue(out.matches("(?s).*\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}.*"),
                "输出应包含可读的运行开始时间,否则没人能看出这是不是最新数据: " + out);
    }

    @Test
    void editByIdWithOnlyNameKeepsPromptAndWeeklySchedule() {
        // WEEKLY 排程只能由面板(或直接写 store)配置,agent 三个 schedule 参数都表达不了它。
        var store = AutomationStore.openDefault();
        var task = new com.lyhn.wraith.automation.AutomationTask();
        task.id = java.util.UUID.randomUUID().toString();
        task.name = "原名";
        task.prompt = "面板配置的原始 prompt,agent 编不出等价复述";
        task.workspace = "/some/workspace";
        var schedule = new com.lyhn.wraith.automation.Schedule();
        schedule.kind = ScheduleKind.WEEKLY;
        schedule.weekday = 3;
        schedule.time = "09:00";
        task.schedule = schedule;
        task.enabled = true;
        task.createdAt = 123L;
        task.enabledAt = 123L;
        store.saveTasks(java.util.List.of(task));

        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("automation_upsert",
                "{\"id\":\"" + task.id + "\",\"name\":\"改名\"}");
        assertFalse(out.startsWith("automation_upsert 失败"), out);

        var after = AutomationStore.openDefault().loadTasks();
        assertEquals(1, after.size());
        var updated = after.get(0);
        assertEquals("改名", updated.name);
        assertEquals(task.prompt, updated.prompt, "省略 prompt 应保留原值,而不是被模型的复述覆盖");
        assertEquals(ScheduleKind.WEEKLY, updated.schedule.kind,
                "省略排程三选一应保留原 WEEKLY,agent 无法表达 WEEKLY 也不该被强迫替换");
        assertEquals(3, updated.schedule.weekday);
        assertEquals("09:00", updated.schedule.time);
    }

    @Test
    void enabledJsonNullIsTreatedAsOmittedNotAsFalse() {
        ToolRegistry reg = new ToolRegistry();
        // JSON null 经 argMap(NullNode#asText())会变成字面串 "null",不是真正的"key 不存在"。
        String out = reg.executeTool("automation_upsert",
                "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\",\"enabled\":null}");
        assertFalse(out.startsWith("automation_upsert 失败"), out);

        var tasks = AutomationStore.openDefault().loadTasks();
        assertEquals(1, tasks.size());
        assertTrue(tasks.get(0).enabled, "enabled:null 应视为未提供,新建任务应保持默认启用而非被静默停用");
        assertTrue(out.contains("启用"), "成功串应体现启用状态: " + out);
    }
}
