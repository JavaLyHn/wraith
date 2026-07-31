package com.lyhn.wraith.tool;

import com.lyhn.wraith.runtime.task.DurableTaskManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class TaskToolsTest {

    @Test
    void toolsFailHonestlyWhenManagerNotInjected() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("task_add", "{\"prompt\":\"跑测试\"}").startsWith("task_add 失败"));
        assertTrue(reg.executeTool("task_list", "{}").startsWith("task_list 失败"));
        assertTrue(reg.executeTool("task_get", "{\"id\":\"x\"}").startsWith("task_get 失败"));
        assertTrue(reg.executeTool("task_cancel", "{\"id\":\"x\"}").startsWith("task_cancel 失败"));
    }

    @Test
    void addThenListThenGetThenCancel(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = new DurableTaskManager(tmp.resolve("tasks.db"), prompt -> "stub-result", 1)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);

            String added = reg.executeTool("task_add", "{\"prompt\":\"跑一遍单测\"}");
            assertFalse(added.startsWith("task_add 失败"), added);

            String id = mgr.list(10).get(0).id();
            assertTrue(added.contains(id), "成功串应含任务 id: " + added);

            String listed = reg.executeTool("task_list", "{}");
            assertTrue(listed.contains(id), listed);

            String got = reg.executeTool("task_get", "{\"id\":\"" + id + "\"}");
            assertTrue(got.contains(id), got);
            assertTrue(got.contains("跑一遍单测"), got);

            String cancelled = reg.executeTool("task_cancel", "{\"id\":\"" + id + "\"}");
            assertFalse(cancelled.startsWith("task_cancel 失败"), cancelled);
        }
    }

    @Test
    void addRejectsBlankPrompt(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = new DurableTaskManager(tmp.resolve("tasks.db"), prompt -> "stub-result", 1)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);
            assertTrue(reg.executeTool("task_add", "{\"prompt\":\"  \"}").startsWith("task_add 失败"));
        }
    }

    @Test
    void getUnknownIdReportsNotFound(@TempDir Path tmp) throws Exception {
        try (DurableTaskManager mgr = new DurableTaskManager(tmp.resolve("tasks.db"), prompt -> "stub-result", 1)) {
            ToolRegistry reg = new ToolRegistry();
            reg.setTaskManager(mgr);
            assertTrue(reg.executeTool("task_get", "{\"id\":\"no-such\"}").startsWith("task_get 失败"));
        }
    }
}
