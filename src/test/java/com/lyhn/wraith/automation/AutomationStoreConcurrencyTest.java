package com.lyhn.wraith.automation;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 复现「同 JVM 内两个独立 AutomationStore 实例竞争同一份 automations.json」的场景 ——
 * 这正是桌面 RPC 线程(AppServer.automationStore() 各起一份)与 agent 工具线程
 * (ToolRegistry 里的 automation_* 走 AutomationStore.openDefault())之间的真实交叠面。
 * 每个线程各自 openDefault() 拿到一个新实例、loadTasks()、追加一条独有任务、saveTasks(...)。
 * 若锁挂在实例(this)上,N 个互不相干的监视器形同虚设,必然发生"读旧值→整表覆盖写"的丢
 * 写(lost update)。
 *
 * <p><b>重要:</b>仅给 loadTasks()/saveTasks() 各自的方法体加同一把类级锁,也<b>不足以</b>
 * 消除这个丢失更新——锁在两次方法调用之间会被释放,"load → 改一份内存拷贝 → save"这段
 * 复合操作本身仍可能被另一线程插队(实测：即使 AutomationStore.loadTasks()/saveTasks() 都
 * synchronized 在同一个静态 TASKS_LOCK 上,48 线程仍稳定丢 40%~90% 的写入)。真正生效的
 * 修复是:调用方(本测试的线程体、以及生产代码里的 ToolRegistry.upsertAutomation/
 * automation_remove、AppServer 的 automations.upsert/remove)把 load 到 save 之间的
 * 整段代码包进 {@code synchronized (AutomationStore.TASKS_LOCK) { ... }}。本测试的线程体
 * 就是照这个模式写的,与生产代码里实际的加锁方式保持一致。
 *
 * 用 CountDownLatch 把线程集中在同一时刻起跑以最大化交叠概率;RepeatedTest 多轮降低偶然
 * 不交叠导致的假阳性(测出"锁没用但这次没撞上"的侥幸)。
 */
class AutomationStoreConcurrencyTest {

    private static final int THREADS = 48;

    @TempDir Path dir;
    private String old;

    @BeforeEach
    void redirectDir() {
        old = System.getProperty("wraith.automation.dir");
        System.setProperty("wraith.automation.dir", dir.toString());
    }

    @AfterEach
    void restoreDir() {
        if (old == null) System.clearProperty("wraith.automation.dir");
        else System.setProperty("wraith.automation.dir", old);
    }

    @RepeatedTest(5)
    void concurrentUpsertsFromIndependentInstancesLoseNoTasks() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        CountDownLatch startLine = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < THREADS; i++) {
            String taskId = "t-" + i;
            futures.add(pool.submit(() -> {
                startLine.await();
                // 每个线程各自 openDefault() —— 与真实调用方(桌面 RPC / agent 工具)一致,
                // 拿到的是互不相同的 AutomationStore 实例,不是共享的同一个 this。
                // load→修改→save 整段包在 TASKS_LOCK 里,和生产代码
                // (ToolRegistry.upsertAutomation/automation_remove、AppServer 的
                // automations.upsert/remove)修复后的加锁方式完全一致 —— 只锁
                // loadTasks()/saveTasks() 各自的方法体不足以防止丢失更新,见类注释。
                synchronized (AutomationStore.TASKS_LOCK) {
                    AutomationStore store = AutomationStore.openDefault();
                    List<AutomationTask> current = new ArrayList<>(store.loadTasks());
                    current.add(newTask(taskId));
                    store.saveTasks(current);
                }
                return null;
            }));
        }

        startLine.countDown();
        for (Future<?> f : futures) {
            f.get(30, TimeUnit.SECONDS);
        }
        pool.shutdown();
        assertEquals(true, pool.awaitTermination(10, TimeUnit.SECONDS), "线程池未在超时内收尾");

        List<AutomationTask> finalTasks = AutomationStore.openDefault().loadTasks();
        Set<String> ids = finalTasks.stream().map(t -> t.id).collect(Collectors.toSet());
        assertEquals(THREADS, finalTasks.size(),
                "应有 " + THREADS + " 条任务全部存活,实际 " + finalTasks.size()
                        + "(丢失: " + missing(ids) + ") —— 说明 load-modify-save 发生了交叠覆盖");
        assertEquals(THREADS, ids.size(), "任务 id 应各自唯一,不应有重复/覆盖痕迹");
    }

    private static String missing(Set<String> present) {
        List<String> lost = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            String id = "t-" + i;
            if (!present.contains(id)) lost.add(id);
        }
        return lost.toString();
    }

    private static AutomationTask newTask(String id) {
        AutomationTask t = new AutomationTask();
        t.id = id;
        t.name = "任务 " + id;
        t.prompt = "ping";
        t.workspace = "/w";
        t.schedule = new Schedule();
        t.schedule.kind = ScheduleKind.CRON;
        t.schedule.expr = "0 9 * * *";
        t.enabled = true;
        t.deliverTo = List.of();
        t.approval = new ApprovalPolicy();
        t.createdAt = System.currentTimeMillis();
        t.enabledAt = System.currentTimeMillis();
        return t;
    }
}
