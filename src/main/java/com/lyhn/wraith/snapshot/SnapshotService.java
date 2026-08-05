package com.lyhn.wraith.snapshot;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class SnapshotService implements AutoCloseable {
    private final SideGitManager manager;
    private final ExecutorService executor;
    private volatile Future<?> lastAsyncTask;
    /**
     * 上一次报过的失败指纹。
     *
     * <p>快照失败**不阻塞对话**（异常被 catch 住），但它会**每轮刷两行**（pre + post）。
     * 用户 Windows 实测截图里就是这样：一次问答里两条 `[!]` 夹在正文中间。
     * 同一个原因只报第一次，后续压成一行短提示 —— 既不掩盖问题，也不淹没正文。
     */
    private volatile String lastReportedFailure;

    /**
     * 失败提示往哪儿输出。
     *
     * <p>默认 stderr。但交互式 CLI 里活动面板有自己的 250ms 重绘线程，直接写 stderr
     * 会撞进它正在写的那一行 —— 用户 Windows 实测就是
     * {@code ▰▱▱…▱ 1%[!] pre-turn 快照失败：…} 挤在一起，尾巴还被下一次重绘覆盖掉。
     * 所以 CLI 会把它换成 {@code renderer::printNotice}（面板同一个 monitor）。
     * 用 {@code Consumer<String>} 而不是直接依赖 Renderer：snapshot 包不该反向依赖 render 包。
     */
    private volatile java.util.function.Consumer<String> noticeSink = System.err::println;

    public SnapshotService(SideGitManager manager) {
        this.manager = manager;
        this.executor = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "wraith-snapshot-writer");
            thread.setDaemon(true);
            return thread;
        });
    }

    public static SnapshotService forProject(Path projectRoot) {
        return new SnapshotService(new SideGitManager(projectRoot));
    }

    public <T> T runTurn(String mode, String input, ThrowingSupplier<T> supplier) throws Exception {
        String turnId = turnId(mode);
        String summary = summarize(mode, input);
        snapshotBeforeTurn(turnId, summary);
        try {
            return supplier.get();
        } finally {
            snapshotAfterTurnAsync(turnId, summary);
        }
    }

    public void snapshotBeforeTurn(String turnId, String summary) {
        if (!manager.config().enabled()) {
            return;
        }
        try {
            manager.preTurnSnapshot(turnId, summary);
            lastReportedFailure = null;   // 恢复正常了,下次再坏要重新完整报一次
        } catch (Exception e) {
            reportFailure("pre-turn", e);
        }
    }

    public void snapshotAfterTurnAsync(String turnId, String summary) {
        if (!manager.config().enabled()) {
            return;
        }
        lastAsyncTask = executor.submit(() -> {
            try {
                manager.postTurnSnapshot(turnId, summary);
                lastReportedFailure = null;
            } catch (Exception e) {
                reportFailure("post-turn", e);
            }
        });
    }

    /**
     * 报告一次快照失败。
     *
     * <p>第一次把<b>完整 cause 链</b>与可行动建议都打出来（JGit 的顶层消息
     * {@code Exception caught during execution of add command} 什么信息都没有，
     * 真正的原因在 cause 里）；同一原因再犯只打一行短的，避免每轮两行淹没正文。
     */
    private void reportFailure(String phase, Throwable error) {
        String fingerprint = SnapshotFailureReport.chain(error);
        if (fingerprint.equals(lastReportedFailure)) {
            noticeSink.accept("⚠️ " + phase + " 快照仍在失败（原因同上）");
            return;
        }
        lastReportedFailure = fingerprint;
        noticeSink.accept(SnapshotFailureReport.describe(phase, error));
    }

    /** 把失败提示改到一个不会撞坏活动面板的出口；传 null 回落 stderr。 */
    public void setNoticeSink(java.util.function.Consumer<String> sink) {
        this.noticeSink = sink == null ? System.err::println : sink;
    }

    public List<TurnSnapshot> listSnapshots(int limit) throws Exception {
        awaitIdle();
        return manager.listSnapshots(limit);
    }

    /** {@code restorePreTurn(offset)} 将要恢复到的快照;供审批预览用,与实际恢复同一来源。 */
    public java.util.Optional<TurnSnapshot> preTurnTarget(int offset) throws Exception {
        awaitIdle();
        return manager.preTurnTarget(offset);
    }

    public RestoreResult restorePreTurn(int offset) throws Exception {
        awaitIdle();
        return manager.restorePreTurn(offset);
    }

    public RestoreResult restoreToCommit(String commitId) throws Exception {
        awaitIdle();
        return manager.restoreToCommit(commitId);
    }

    public String status() {
        return manager.formatStatus();
    }

    public String clean() {
        return manager.cleanSnapshots();
    }

    public SideGitManager manager() {
        return manager;
    }

    public void awaitIdle() throws Exception {
        Future<?> task = lastAsyncTask;
        if (task != null) {
            task.get(60, TimeUnit.SECONDS);
        }
    }

    /**
     * 关服务，<b>但先给排队中的 post-turn 快照一点时间写完</b>。
     *
     * <p>原来直接 {@code shutdownNow()}：排队还没开跑的任务会被<b>直接从队列里丢掉</b>，
     * 已经开跑的会被打断在 {@code git add} 中途 —— 后者会把 {@code index.lock} 留在
     * Side-Git 里，而在 {@link SnapshotLockRecovery} 之前那等于把快照永久搞坏
     * （用户 Windows 实测就是这个下场）。
     *
     * <p>只等 {@value #CLOSE_GRACE_SECONDS} 秒：快照不重要到值得卡住退出，
     * 但也不该每次正常退出都留一把锁。等不完仍然强关 —— 那时自愈逻辑会在下次兜住。
     */
    @Override
    public void close() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(CLOSE_GRACE_SECONDS, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    static final long CLOSE_GRACE_SECONDS = 3;

    private static String turnId(String mode) {
        String safeMode = mode == null || mode.isBlank() ? "turn" : mode.toLowerCase().replaceAll("[^a-z0-9_-]", "-");
        return safeMode + "-" + Instant.now().toEpochMilli();
    }

    private static String summarize(String mode, String input) {
        String normalized = input == null ? "" : input.replaceAll("\\s+", " ").trim();
        if (normalized.length() > 120) {
            normalized = normalized.substring(0, 120) + "...";
        }
        return "mode=" + (mode == null ? "turn" : mode) + "\ninput=" + normalized;
    }

    @FunctionalInterface
    public interface ThrowingSupplier<T> {
        T get() throws Exception;
    }
}
