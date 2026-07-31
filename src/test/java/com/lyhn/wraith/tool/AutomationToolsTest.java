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
    void runNowQueuesRequestAndSaysItNeedsDaemon() {
        ToolRegistry reg = new ToolRegistry();
        reg.executeTool("automation_upsert", "{\"name\":\"n\",\"prompt\":\"x\",\"cron\":\"0 9 * * *\"}");
        String id = AutomationStore.openDefault().loadTasks().get(0).id;
        String out = reg.executeTool("automation_run_now", "{\"id\":\"" + id + "\"}");
        assertFalse(out.startsWith("automation_run_now 失败"), out);
        assertTrue(out.contains("守护"), "必须说明需要守护进程运行才会真的执行,实际: " + out);
        assertTrue(java.nio.file.Files.isDirectory(AutomationStore.defaultRequestsDir()), "应写出 request inbox 目录");
    }

    @Test
    void runsListingWorksOnEmptyStore() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.executeTool("automation_runs", "{}").startsWith("automation_runs 失败"));
    }
}
