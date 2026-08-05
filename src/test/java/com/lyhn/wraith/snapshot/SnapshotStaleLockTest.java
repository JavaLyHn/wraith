package com.lyhn.wraith.snapshot;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 用户 Windows 实测（带上 cause 链之后才看得见的那条）：
 * <pre>
 * [!] pre-turn 快照失败：JGitInternalException: Exception caught during execution of add command
 *   ← LockFailedException: Cannot lock C:\Users\LyHn\.wraith\snapshots\...\.git\index.
 *     Ensure that no other process has an open file handle on the lock file ...\index.lock,
 *     then you may delete the lock file and retry.
 * </pre>
 *
 * <p><b>这解释了「为什么失败了都」</b>：某个进程死在 {@code git add} 中途（Side-Git 的写入线程是
 * daemon，JVM 一退就没了；用户此前反复在那 8 秒同步 pre-turn 里强杀进程），
 * {@code index.lock} 留在原地 —— 而代码<b>没有任何恢复路径</b>，
 * 于是之后每一次快照、每一次重启，永远撞同一个锁。
 */
class SnapshotStaleLockTest {

    @TempDir
    Path tempDir;

    private SideGitManager manager(Path project, Path snapshots) throws IOException {
        Files.createDirectories(project);
        Files.writeString(project.resolve("a.txt"), "hello");
        return new SideGitManager(project, new SnapshotConfig(true, snapshots, 50, List.of(".git")));
    }

    /** 复刻「进程死在 add 中途」：锁文件留着，且时间戳是过去的。 */
    private Path strandLock(SideGitManager manager, String relative, long ageSeconds) throws IOException {
        Path lock = manager.gitDir().resolve(relative);
        Files.createDirectories(lock.getParent());
        Files.writeString(lock, "");
        Files.setLastModifiedTime(lock, FileTime.from(Instant.now().minusSeconds(ageSeconds)));
        return lock;
    }

    @Test
    @DisplayName("**陈旧 index.lock 不能让快照永久失效** —— 这才是「失败了都」的根因")
    void staleIndexLockMustNotDoomEverySnapshotForever() throws Exception {
        SideGitManager manager = manager(tempDir.resolve("project"), tempDir.resolve("snapshots"));
        manager.preTurnSnapshot("turn-1", "首轮,把仓库建起来");

        Path lock = strandLock(manager, "index.lock", 600);

        TurnSnapshot snapshot = manager.preTurnSnapshot("turn-2", "锁还在,但那是个死锁");

        assertTrue(snapshot != null, "残留锁必须能自愈,否则用户只能手动删文件");
        assertFalse(Files.exists(lock), "陈旧锁该被清掉,不然下一轮又撞: " + lock);
    }

    @Test
    @DisplayName("**刚创建的锁不能抢** —— 那可能是另一个 wraith 进程正在写(桌面端 + CLI 同时开)")
    void freshLockIsNotStolenFromALiveProcess() throws Exception {
        SideGitManager manager = manager(tempDir.resolve("project"), tempDir.resolve("snapshots"));
        manager.preTurnSnapshot("turn-1", "首轮");

        Path lock = strandLock(manager, "index.lock", 0);

        assertThrows(Exception.class, () -> manager.preTurnSnapshot("turn-2", "别人正在写"),
                "锁是新的就该老实失败,抢锁会让对方的快照写坏");
        assertTrue(Files.exists(lock), "不能删别人还在用的锁");
    }

    @Test
    @DisplayName("自愈之后快照内容仍然正确 —— 不能为了不报错就交一张空快照")
    void recoveredSnapshotStillCapturesTheWorkingTree() throws Exception {
        Path project = tempDir.resolve("project");
        SideGitManager manager = manager(project, tempDir.resolve("snapshots"));
        manager.preTurnSnapshot("turn-1", "首轮");

        Files.writeString(project.resolve("a.txt"), "changed after the crash");
        strandLock(manager, "index.lock", 600);
        manager.postTurnSnapshot("turn-2", "自愈这一轮");

        Files.writeString(project.resolve("a.txt"), "later");
        List<TurnSnapshot> all = manager.listSnapshots(10);
        assertEquals(SnapshotPhase.POST_TURN, all.get(0).phase());

        RestoreResult restored = manager.restoreToCommit(all.get(0).commitId());
        assertTrue(restored.success(), restored.message());
        assertEquals("changed after the crash", Files.readString(project.resolve("a.txt")),
                "自愈的那张快照必须真的记下了当时的内容");
    }

    @Test
    @DisplayName("**关服务时不能丢掉排队中的 post-turn** —— 那正是残留锁的产地")
    void closeLetsThePendingPostTurnSnapshotFinish() throws Exception {
        Path project = tempDir.resolve("project");
        Files.createDirectories(project);
        SnapshotService service = new SnapshotService(new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git"))));

        service.runTurn("react", "写个文件", () -> {
            Files.writeString(project.resolve("a.txt"), "created");
            return "ok";
        });
        service.close();   // 不再 awaitIdle:close 自己就该等

        List<TurnSnapshot> all = service.manager().listSnapshots(10);
        assertEquals(SnapshotPhase.POST_TURN, all.get(0).phase(),
                "post-turn 还在队列里就被 shutdownNow 丢掉了,那一轮的收尾快照永久丢失: " + all);
    }

    @Test
    @DisplayName("锁不是普通文件时不碰它 —— 只删「一个普通文件」这一种确定的形态")
    void doesNotTouchALockThatIsNotAPlainFile() throws Exception {
        SideGitManager manager = manager(tempDir.resolve("project"), tempDir.resolve("snapshots"));
        manager.preTurnSnapshot("turn-1", "首轮");

        Path lock = manager.gitDir().resolve("index.lock");
        Files.createDirectories(lock);
        Files.writeString(lock.resolve("occupied"), "");
        Files.setLastModifiedTime(lock, FileTime.from(Instant.now().minusSeconds(600)));

        assertThrows(Exception.class, () -> manager.preTurnSnapshot("turn-2", "形态不对的锁"));
        assertTrue(Files.isDirectory(lock), "认不出的形态要原样留着,不能拿删除去试探");
    }

    @Test
    @DisplayName("**清过锁仍失败时不能再叫用户删一遍** —— 那个文件刚刚已经被删掉了")
    void hintStopsTellingUserToDeleteALockThatIsAlreadyGone() {
        Throwable retryFailure = SnapshotLockRecovery.retryStillFailed(
                Path.of("/home/u/.wraith/snapshots/aa/bb/.git/index.lock"),
                new IllegalStateException("Exception caught during execution of add command",
                        new org.eclipse.jgit.errors.LockFailedException(
                                Path.of("/home/u/.wraith/snapshots/aa/bb/.git/index").toFile())));

        String hint = SnapshotFailureReport.actionableHint(retryFailure);
        assertTrue(hint.contains("已经自动清掉"), hint);
        assertFalse(hint.contains("删掉 ~/.wraith"), "别再指使用户去删已经没了的文件: " + hint);

        String report = SnapshotFailureReport.describe("pre-turn", retryFailure);
        assertTrue(report.contains(SnapshotLockRecovery.ALREADY_CLEARED), report);
        assertTrue(report.contains("Cannot lock"), "原文仍要在,那才是能继续查的东西: " + report);
    }
}
