package com.lyhn.wraith.snapshot;

import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 快照失败提示<b>不能</b>直接写 stderr。
 *
 * <p>用户 Windows 实测的原样输出：
 * <pre>
 *     ▰▱▱▱▱▱▱… 1%[!] pre-turn 快照失败：JGitInternalException: …
 *    （不想要快照可以关掉：设 WRAITH_SNAPSHOT_ENABLED=false，或 -Dwraith.snapshot.enabled?
 * </pre>
 * 提示被挤进活动面板的进度条那一行，末尾 {@code =false）} 还被下一次重绘覆盖掉 ——
 * <b>连「怎么关掉」都没读全</b>。面板有自己的 250ms 重绘线程，所以提示必须走它同一个出口。
 */
class SnapshotNoticeRoutingTest {

    @TempDir
    Path tempDir;

    private SnapshotService failingService(Path project) throws Exception {
        Files.createDirectories(project);
        Files.writeString(project.resolve("a.txt"), "hello");
        SideGitManager manager = new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git")));
        manager.preTurnSnapshot("turn-1", "先把仓库建起来");
        // 一把**认不出形态**的锁:自愈逻辑不会碰它,于是后面每次快照都真的失败。
        Path lock = manager.gitDir().resolve("index.lock");
        Files.createDirectories(lock);
        Files.setLastModifiedTime(lock, FileTime.from(Instant.now().minusSeconds(600)));
        return new SnapshotService(manager);
    }

    @Test
    @DisplayName("**失败提示走 sink,不走 stderr** —— 交互式 CLI 靠它避开面板重绘")
    void failureGoesToTheInjectedSink() throws Exception {
        SnapshotService service = failingService(tempDir.resolve("project"));
        List<String> notices = new ArrayList<>();
        service.setNoticeSink(notices::add);

        service.snapshotBeforeTurn("turn-2", "会失败的一轮");

        assertEquals(1, notices.size(), "一次失败一条,不能拆成好几段写(拆开就会被重绘插进来): " + notices);
        assertTrue(notices.get(0).contains("pre-turn"), notices.get(0));
        assertTrue(notices.get(0).contains("WRAITH_SNAPSHOT_ENABLED=false"),
                "「怎么关掉」必须完整送到出口: " + notices.get(0));
        service.close();
    }

    @Test
    @DisplayName("同一个原因第二次只压成一行 —— 但仍然走同一个出口")
    void repeatFailureIsCondensedOnTheSameSink() throws Exception {
        SnapshotService service = failingService(tempDir.resolve("project"));
        List<String> notices = new ArrayList<>();
        service.setNoticeSink(notices::add);

        service.snapshotBeforeTurn("turn-2", "第一次");
        service.snapshotBeforeTurn("turn-3", "第二次");

        assertEquals(2, notices.size(), notices.toString());
        assertTrue(notices.get(1).contains("原因同上"), notices.get(1));
        assertTrue(notices.get(1).length() < notices.get(0).length(), "第二条该更短");
        service.close();
    }

    @Test
    @DisplayName("传 null 回落 stderr —— 不能因为没设 sink 就把提示吞掉")
    void nullSinkFallsBackInsteadOfSwallowing() throws Exception {
        SnapshotService service = failingService(tempDir.resolve("project"));
        List<String> notices = new ArrayList<>();
        service.setNoticeSink(notices::add);
        service.setNoticeSink(null);

        service.snapshotBeforeTurn("turn-2", "没有 sink 的一轮");

        assertTrue(notices.isEmpty(), "已经撤掉的 sink 不该再收到");
        service.close();   // 提示去了 stderr;这里只验证「没被吞、也没抛」
    }

    @Test
    @DisplayName("**换项目不能把出口丢掉** —— setProjectPath 会整个换掉 SnapshotService")
    void sinkSurvivesProjectPathChange() throws Exception {
        // 让 registry 新建的 service 落在临时目录,绝不碰真实的 ~/.wraith/snapshots
        System.setProperty("wraith.snapshot.dir", tempDir.resolve("registry-snapshots").toString());
        try {
            ToolRegistry registry = new ToolRegistry();
            List<String> notices = new ArrayList<>();
            registry.setSnapshotNoticeSink(notices::add);
            SnapshotService before = registry.getSnapshotService();

            Path other = tempDir.resolve("other-project");
            Files.createDirectories(other);
            Files.writeString(other.resolve("a.txt"), "hello");
            registry.setProjectPath(other.toString());

            SnapshotService after = registry.getSnapshotService();
            assertFalse(before == after, "前提:换项目确实换了 service,否则这条测试没在测东西");

            after.snapshotBeforeTurn("turn-1", "先把新项目的仓建起来");
            Path lock = after.manager().gitDir().resolve("index.lock");
            Files.createDirectories(lock);   // 认不出的形态:自愈不碰,于是必然失败
            Files.setLastModifiedTime(lock, FileTime.from(Instant.now().minusSeconds(600)));
            notices.clear();

            after.snapshotBeforeTurn("turn-2", "换项目之后失败的一轮");

            assertEquals(1, notices.size(),
                    "换项目后失败提示仍要走注入的出口,否则又静默退回 stderr 撞花面板: " + notices);
            assertTrue(notices.get(0).contains("pre-turn"), notices.get(0));
            after.close();
        } finally {
            System.clearProperty("wraith.snapshot.dir");
        }
    }
}
