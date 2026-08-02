package com.lyhn.wraith.runtime.task;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 后台任务的删除。
 *
 * <p>用户要求「新增删除功能；点击重试以后之前的就不要了，只保留重试的最新的」。
 * 这<b>推翻</b>了重试刚落地时的设计——那时特意保留失败记录，理由是「失败发生过，
 * 审计上不该被抹掉」。用户的反馈是对的：这是一个任务队列面板，不是审计日志
 * （真正的审计在 {@code ~/.wraith/audit/}），一屏失败记录只会淹掉在跑的那条。
 *
 * <p><b>为什么运行中的任务不许删</b>：worker 线程还活着。删了行之后它跑完会去
 * {@code markTerminal} 一个不存在的 id —— SQL 层面 UPDATE 影响 0 行，静悄悄地过去了，
 * 于是「任务从列表上消失了，但它确实改了你的文件」。这种状态没法向用户解释。
 * 先取消再删，两步都有明确语义。
 */
class DurableTaskDeleteTest {

    @Test
    @DisplayName("删掉终态任务:行没了,列表里也没了")
    void deletesTerminalTask(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> "done", 1)) {
            manager.start();
            DurableTask task = manager.enqueue("hello");
            waitForTerminal(manager, task.id());

            assertTrue(manager.delete(task.id()));
            assertTrue(manager.find(task.id()).isEmpty());
            assertTrue(manager.list(10).stream().noneMatch(t -> t.id().equals(task.id())));
        }
    }

    @Test
    @DisplayName("失败的任务能删 —— 重试要顶替的就是这一条")
    void deletesFailedTask(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"),
                prompt -> { throw new IllegalStateException("boom"); },
                1)) {
            manager.start();
            DurableTask task = manager.enqueue("will fail");
            assertEquals(TaskStatus.FAILED, waitForTerminal(manager, task.id()).status());

            assertTrue(manager.delete(task.id()));
            assertTrue(manager.find(task.id()).isEmpty());
        }
    }

    @Test
    @DisplayName("已取消的也能删")
    void deletesCanceledTask(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> { Thread.sleep(5000); return "late"; }, 1)) {
            manager.start();
            DurableTask task = manager.enqueue("slow");
            waitUntilStatus(manager, task.id(), TaskStatus.RUNNING);
            manager.cancel(task.id());
            waitForTerminal(manager, task.id());

            assertTrue(manager.delete(task.id()));
        }
    }

    @Test
    @DisplayName("运行中的不许删 —— 删了行,worker 照样在改文件,而列表上它已经消失")
    void refusesRunningTask(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> { Thread.sleep(3000); return "late"; }, 1)) {
            manager.start();
            DurableTask task = manager.enqueue("slow");
            waitUntilStatus(manager, task.id(), TaskStatus.RUNNING);

            assertFalse(manager.delete(task.id()), "得先取消");
            assertTrue(manager.find(task.id()).isPresent(), "拒绝之后行必须还在");

            manager.cancel(task.id());
            waitForTerminal(manager, task.id());
            assertTrue(manager.delete(task.id()), "取消完就能删了");
        }
    }

    @Test
    @DisplayName("排队中的也不许删 —— 它随时会被 worker 领走")
    void refusesEnqueuedTask(@TempDir Path tempDir) throws Exception {
        // 不 start():没有 worker,任务稳定停在 enqueued
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> "never", 1)) {
            DurableTask task = manager.enqueue("waiting");

            assertFalse(manager.delete(task.id()));
            assertTrue(manager.find(task.id()).isPresent());
        }
    }

    @Test
    @DisplayName("不存在 / 空 id → false,不抛")
    void missingIdIsFalseNotThrow(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> "x", 1)) {
            assertFalse(manager.delete("task_doesnotexist"));
            assertFalse(manager.delete(""));
            assertFalse(manager.delete(null));
        }
    }

    @Test
    @DisplayName("只删指定那一条,不误伤邻居")
    void deletesOnlyTheTarget(@TempDir Path tempDir) throws Exception {
        try (DurableTaskManager manager = new DurableTaskManager(
                tempDir.resolve("tasks.db"), prompt -> "done", 1)) {
            manager.start();
            DurableTask a = manager.enqueue("first");
            DurableTask b = manager.enqueue("second");
            waitForTerminal(manager, a.id());
            waitForTerminal(manager, b.id());

            assertTrue(manager.delete(a.id()));
            assertTrue(manager.find(b.id()).isPresent(), "删 a 不能带走 b");
        }
    }

    @Test
    @DisplayName("删除是持久的 —— 重开进程它不会自己回来")
    void deletionSurvivesRestart(@TempDir Path tempDir) throws Exception {
        Path db = tempDir.resolve("tasks.db");
        String id;
        try (DurableTaskManager manager = new DurableTaskManager(db, prompt -> "done", 1)) {
            manager.start();
            id = manager.enqueue("gone").id();
            waitForTerminal(manager, id);
            assertTrue(manager.delete(id));
        }
        try (DurableTaskManager reopened = new DurableTaskManager(db, prompt -> "done", 1)) {
            assertTrue(reopened.find(id).isEmpty());
        }
    }

    private static DurableTask waitForTerminal(DurableTaskManager manager, String id) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            DurableTask task = manager.find(id).orElseThrow();
            if (task.terminal()) {
                return task;
            }
            Thread.sleep(20);
        }
        fail("task did not finish in time");
        return null;
    }

    private static void waitUntilStatus(DurableTaskManager manager, String id, TaskStatus status)
            throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            if (manager.find(id).orElseThrow().status() == status) {
                return;
            }
            Thread.sleep(20);
        }
        fail("task did not reach status " + status);
    }
}
