package com.lyhn.wraith.automation;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Scheduler — 有界并发定时自动化调度器。
 *
 * <p>功能：
 * <ul>
 *   <li>{@link #decideTick()} — 纯粹的单次 tick 判定（可直接在测试中调用）。</li>
 *   <li>{@link #start()} / {@link #stop()} — 生产用 30s 定时循环。</li>
 *   <li>{@link #requestRunNow(String)} — 立即触发（不更新 lastFiredAt）。</li>
 *   <li>{@link #sweepInterrupted()} — 启动时清理非终态旧 run。</li>
 * </ul>
 */
public final class Scheduler {

    // ─────────────────────────────────────────────────────────────────────────
    // Nested types
    // ─────────────────────────────────────────────────────────────────────────

    /** 投递回调 — 每次任务跑完后调用一次。 */
    public interface OnResult {
        void deliver(AutomationTask task, AutomationRunner.RunResult result);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fields
    // ─────────────────────────────────────────────────────────────────────────

    private final AutomationStore store;
    private final AutomationRunner.TurnEngine engine;
    private final OnResult onResult;
    private final LongSupplier clock;

    /** 当前正在活跃（已入队但尚未完成）的 taskId 集合，用于去重。 */
    private final Set<String> activeTaskIds = ConcurrentHashMap.newKeySet();

    /** 有界线程池：同时最多 maxConcurrent 个任务并发跑。 */
    private final ExecutorService pool;

    /** 生产用定时触发器（start/stop 管理）。 */
    private ScheduledExecutorService ticker;

    /** start() 幂等守卫：已启动则为 true。 */
    private boolean started = false;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    public Scheduler(AutomationStore store,
                     AutomationRunner.TurnEngine engine,
                     OnResult onResult,
                     int maxConcurrent,
                     LongSupplier clock) {
        this.store = store;
        this.engine = engine;
        this.onResult = onResult;
        this.clock = clock;
        this.pool = Executors.newFixedThreadPool(maxConcurrent, r -> {
            Thread t = new Thread(r, "wraith-automation-worker");
            t.setDaemon(true);
            return t;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 单次 tick 判定：遍历所有任务，对满足条件的任务调用 {@link #fire(AutomationTask, boolean)}。
     * <p>条件：enabled 且无活跃 run 且 clock >= computeNextRun(...)。
     * <p>每个 task 内部独立 try/catch，一个坏 task 不影响其他任务。
     */
    public void decideTick() {
        long now = clock.getAsLong();
        List<AutomationTask> tasks;
        try {
            tasks = store.loadTasks();
        } catch (Exception e) {
            System.err.println("[Scheduler] loadTasks 失败: " + e.getMessage());
            return;
        }
        for (AutomationTask task : tasks) {
            try {
                if (!task.enabled) continue;
                if (activeTaskIds.contains(task.id)) continue;
                long next = NextRun.computeNextRun(task.schedule, now, store.lastFiredAt(task.id), task.enabledAt);
                if (now >= next) {
                    fire(task, true);
                }
            } catch (Exception e) {
                System.err.println("[Scheduler] tick 处理 task " + task.id + " 出错: " + e.getMessage());
            }
        }
    }

    /**
     * 立即触发指定任务（不更新 lastFiredAt）。
     * 若任务当前已有活跃 run 则跳过。
     */
    public void requestRunNow(String taskId) {
        List<AutomationTask> tasks;
        try {
            tasks = store.loadTasks();
        } catch (Exception e) {
            System.err.println("[Scheduler] requestRunNow loadTasks 失败: " + e.getMessage());
            return;
        }
        for (AutomationTask task : tasks) {
            if (task.id != null && task.id.equals(taskId)) {
                if (activeTaskIds.contains(task.id)) return;
                fire(task, false);
                return;
            }
        }
        System.err.println("[Scheduler] requestRunNow: 未找到 taskId=" + taskId);
    }

    /**
     * 启动生产定时器：每 30 秒调用一次 {@link #decideTick()}。
     * <p>幂等：重复调用不会创建第二个 ticker。
     */
    public void start() {
        if (started) return;
        started = true;
        ticker = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "wraith-scheduler-ticker");
            t.setDaemon(true);
            return t;
        });
        ticker.scheduleAtFixedRate(() -> {
            try {
                decideTick();
            } catch (Exception e) {
                System.err.println("[Scheduler] tick 异常: " + e.getMessage());
            }
        }, 0, 30, TimeUnit.SECONDS);
    }

    /**
     * 停止定时器和工作线程池。
     */
    public void stop() {
        if (ticker != null) {
            ticker.shutdown();
        }
        pool.shutdown();
        started = false;
    }

    /**
     * 将非终态旧 run 标记为 interrupted（通常在进程启动时调用）。
     */
    public void sweepInterrupted() {
        try {
            List<AutomationRun> nonTerminal = store.nonTerminalRuns();
            long now = clock.getAsLong();
            for (AutomationRun run : nonTerminal) {
                try {
                    run.status = "interrupted";
                    run.summary = "进程重启，run 被标记为 interrupted";
                    run.endedAt = now;
                    store.putRun(run);
                } catch (Exception e) {
                    System.err.println("[Scheduler] sweepInterrupted putRun 失败 runId=" + run.runId + ": " + e.getMessage());
                }
            }
        } catch (Exception e) {
            System.err.println("[Scheduler] sweepInterrupted 失败: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 将任务加入活跃集合并提交到线程池执行。
     *
     * @param task          要执行的任务
     * @param advanceAnchor 是否在开始时更新 lastFiredAt（decideTick=true, requestRunNow=false）
     */
    private void fire(AutomationTask task, boolean advanceAnchor) {
        activeTaskIds.add(task.id);

        // 写 running run 记录
        long now = clock.getAsLong();
        AutomationRun startRun = new AutomationRun();
        startRun.runId = UUID.randomUUID().toString();
        startRun.taskId = task.id;
        startRun.startedAt = now;
        startRun.status = "running";
        try {
            store.putRun(startRun);
        } catch (Exception e) {
            System.err.println("[Scheduler] fire putRun(running) 失败 taskId=" + task.id + ": " + e.getMessage());
        }

        // 推进锚点（requestRunNow 不推进）
        if (advanceAnchor) {
            try {
                store.setLastFiredAt(task.id, now);
            } catch (Exception e) {
                System.err.println("[Scheduler] fire setLastFiredAt 失败 taskId=" + task.id + ": " + e.getMessage());
            }
        }

        final String runId = startRun.runId;
        pool.submit(() -> {
            AutomationRunner.RunResult result = null;
            try {
                result = engine.run(task);

                // 写终态 run 记录
                AutomationRun endRun = new AutomationRun();
                endRun.runId = runId;
                endRun.taskId = task.id;
                endRun.startedAt = now;
                endRun.endedAt = clock.getAsLong();
                endRun.status = result.status();
                endRun.sessionId = result.sessionId();
                endRun.summary = collapseWhitespace(tail120(result.answer()));
                try {
                    store.putRun(endRun);
                } catch (Exception e) {
                    System.err.println("[Scheduler] pool putRun(terminal) 失败 taskId=" + task.id + ": " + e.getMessage());
                }

                // 投递结果
                try {
                    onResult.deliver(task, result);
                } catch (Exception e) {
                    System.err.println("[Scheduler] onResult.deliver 失败 taskId=" + task.id + ": " + e.getMessage());
                }
            } catch (Exception e) {
                System.err.println("[Scheduler] engine.run 失败 taskId=" + task.id + ": " + e.getMessage());
                // 写 failed run
                try {
                    AutomationRun failRun = new AutomationRun();
                    failRun.runId = runId;
                    failRun.taskId = task.id;
                    failRun.startedAt = now;
                    failRun.endedAt = clock.getAsLong();
                    failRun.status = "failed";
                    failRun.summary = "引擎异常: " + e.getMessage();
                    store.putRun(failRun);
                } catch (Exception ignored) {}
            } finally {
                activeTaskIds.remove(task.id);
            }
        });
    }

    /** 取字符串末尾最多 120 个字符。 */
    private static String tail120(String s) {
        if (s == null) return "";
        int len = s.length();
        return len <= 120 ? s : s.substring(len - 120);
    }

    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    /** 将多余空白折叠为单个空格并 trim。 */
    private static String collapseWhitespace(String s) {
        if (s == null || s.isBlank()) return "";
        return WHITESPACE.matcher(s.strip()).replaceAll(" ");
    }
}
