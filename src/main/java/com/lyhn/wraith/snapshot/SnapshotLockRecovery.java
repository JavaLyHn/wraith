package com.lyhn.wraith.snapshot;

import org.eclipse.jgit.errors.LockFailedException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

/**
 * 清理<b>死掉的进程留下的</b> Side-Git 锁文件。
 *
 * <p><b>起因</b>（用户 Windows 实测，带上 cause 链之后才看得见）：
 * <pre>
 * LockFailedException: Cannot lock ...\.git\index. Ensure that no other process has an open
 * file handle on the lock file ...\index.lock, then you may delete the lock file and retry.
 * </pre>
 *
 * <p>这解释了「为什么<b>全都</b>失败」：Side-Git 的写入线程是 daemon 线程，JVM 一退就没了，
 * {@code finally} 里的 {@code LockFile.unlock()} 不会跑；用户此前又反复在那 8 秒同步 pre-turn
 * 里强杀进程。锁文件一旦留下，代码<b>没有任何恢复路径</b> —— 之后每一轮、每一次重启，
 * 都撞同一个锁，直到手工删文件。<b>已在 mac 上复现到同一个异常，与操作系统无关。</b>
 *
 * <p>所以这里做的判断只有一个：<b>这把锁是死的，还是别人正在用的？</b>
 * 判据是锁文件的时间戳。实测一次 pre-turn 快照最慢约 8 秒（大仓库 + Windows），
 * 默认 {@value #DEFAULT_STALE_SECONDS} 秒的阈值留了足够余量 ——
 * 因为「抢走一个活进程的锁」并不是没有代价的：对方那一次快照会失败。
 * （反过来，抢错的代价也<b>仅限于此</b>：add/commit 不动工作区，用户的文件不会因此损坏。）
 *
 * <p>拿不准就<b>不动</b>，把原异常照原样报上去 —— 原消息里本来就写着怎么手工删。
 */
public final class SnapshotLockRecovery {

    private SnapshotLockRecovery() {
    }

    /** 默认多久算「死锁」。实测最慢一次 pre-turn 约 8 秒,留足余量。 */
    static final long DEFAULT_STALE_SECONDS = 60;

    /**
     * 已经替用户清过锁的标记。
     *
     * <p>清完还失败时必须带上它：否则报告会继续说「删掉 index.lock 再试」，
     * 而那个文件刚刚已经被删过了 —— 用户会照着建议去删一个不存在的文件。
     */
    static final String ALREADY_CLEARED = "已自动清理陈旧锁";

    /**
     * 从异常链里找出<b>可以安全删除</b>的锁文件；拿不准返回 {@code null}。
     *
     * <p>{@code LockFailedException.getFile()} 给的是<b>被锁的文件</b>（{@code index}），
     * 锁文件是它加上 {@code .lock}（JGit {@code LockFile.LOCK_SUFFIX}）。
     * 用异常自带的路径而不是自己拼 {@code gitDir/index.lock}：commit 也会锁 ref，
     * 将来若有别的锁走同一条通道，这里不用改。
     */
    static Path recoverableLock(Throwable error) {
        return recoverableLock(error, staleAfter());
    }

    static Path recoverableLock(Throwable error, Duration staleAfter) {
        LockFailedException failure = findLockFailure(error);
        if (failure == null || failure.getFile() == null) {
            return null;
        }
        Path lock = Path.of(failure.getFile().getPath() + ".lock");
        // 目录、不存在、符号链接 —— 一律不碰。只删「一个普通文件」这一种确定的形态。
        if (!Files.isRegularFile(lock)) {
            return null;
        }
        try {
            Instant modified = Files.getLastModifiedTime(lock).toInstant();
            return modified.isBefore(Instant.now().minus(staleAfter)) ? lock : null;
        } catch (IOException e) {
            return null;
        }
    }

    /** 删锁。删不掉就返回 {@code false} —— 调用方应当把原异常照原样报出去。 */
    static boolean clear(Path lock) {
        try {
            Files.deleteIfExists(lock);
            return !Files.exists(lock);
        } catch (IOException e) {
            return false;
        }
    }

    /** 清过锁仍然失败 —— 包一层，让报告能说清「锁已经清过了，问题在别处」。 */
    static IOException retryStillFailed(Path lock, Throwable retryError) {
        return new IOException(ALREADY_CLEARED + "（" + lock + "）后重试仍失败", retryError);
    }

    private static LockFailedException findLockFailure(Throwable error) {
        Throwable current = error;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof LockFailedException lockFailure) {
                return lockFailure;
            }
            if (current.getCause() == current) {
                return null;
            }
            current = current.getCause();
            depth++;
        }
        return null;
    }

    private static Duration staleAfter() {
        String value = System.getProperty("wraith.snapshot.staleLockSeconds");
        if (value == null) {
            value = System.getenv("WRAITH_SNAPSHOT_STALE_LOCK_SECONDS");
        }
        if (value != null && !value.isBlank()) {
            try {
                long seconds = Long.parseLong(value.trim());
                if (seconds >= 0) {
                    return Duration.ofSeconds(seconds);
                }
            } catch (NumberFormatException ignored) {
                // 配错了就用默认值,不因为一个环境变量把快照整个搞停
            }
        }
        return Duration.ofSeconds(DEFAULT_STALE_SECONDS);
    }
}
