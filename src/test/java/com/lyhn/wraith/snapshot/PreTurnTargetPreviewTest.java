package com.lyhn.wraith.snapshot;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * revert_turn 的审批卡要能说清「你将回到哪一个快照」。预览若和实际恢复的不是同一个
 * commit,比没有预览更糟 —— 用户是照着预览批准的。
 *
 * 因此选择逻辑必须是**单一来源**:{@code preTurnTarget(offset)} 既供预览,也被
 * {@code restorePreTurn(offset)} 自己使用。本用例正是钉住这一点。
 *
 * 注意 restorePreTurn 走的是 listPreTurnSnapshots(只筛 PRE_TURN),不是 listSnapshots
 * (含 post-turn / pre-restore)—— 拿后者按序号取会错开。
 */
class PreTurnTargetPreviewTest {

    @TempDir Path tempDir;

    private SideGitManager manager() throws Exception {
        Path project = tempDir.resolve("project");
        Files.createDirectories(project);
        return new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git", "target")));
    }

    @Test
    void previewTargetIsExactlyWhatRestoreUses() throws Exception {
        SideGitManager m = manager();
        Path project = tempDir.resolve("project");

        Files.writeString(project.resolve("a.txt"), "v1");
        m.preTurnSnapshot("turn-1", "第一轮");
        m.postTurnSnapshot("turn-1", "第一轮完成");      // 混入非 pre-turn,防按 listSnapshots 取偏
        Files.writeString(project.resolve("a.txt"), "v2");
        m.preTurnSnapshot("turn-2", "第二轮");
        m.postTurnSnapshot("turn-2", "第二轮完成");
        Files.writeString(project.resolve("a.txt"), "v3");
        m.preTurnSnapshot("turn-3", "第三轮");

        for (int offset = 1; offset <= 3; offset++) {
            Optional<TurnSnapshot> preview = m.preTurnTarget(offset);
            assertTrue(preview.isPresent(), "offset=" + offset + " 应能预览到目标");
            RestoreResult restored = m.restorePreTurn(offset);
            assertTrue(restored.success(), restored.toString());
            assertEquals(preview.get().commitId(), restored.commitId(),
                    "offset=" + offset + ":预览的 commit 与实际恢复的必须一致");
        }
    }

    @Test
    void previewCarriesTimeAndSummaryNotJustAnOrdinal() throws Exception {
        SideGitManager m = manager();
        Files.writeString(tempDir.resolve("project").resolve("a.txt"), "v1");
        m.preTurnSnapshot("turn-1", "改 Sidebar");

        TurnSnapshot t = m.preTurnTarget(1).orElseThrow();
        assertEquals(SnapshotPhase.PRE_TURN, t.phase(), "只能选 pre-turn");
        assertTrue(t.createdAt() != null, "没有时间戳,审批卡说不清是哪次");
        assertTrue(t.summary() != null && t.summary().contains("改 Sidebar"),
                "没有摘要,用户只看到一个序号,等于盲批:" + t.summary());
    }

    /**
     * 桌面 snapshotView.summaryInput() 靠 summary 里的 `mode=…\ninput=…` 抠出当时的输入
     * (见其注释)。写入端一直按这个格式塞进 commit body,读取端却只取首行 —— 面板的
     * 「当时输入」于是永远是空的。这条钉住那个契约。
     */
    @Test
    void summaryKeepsDesktopContractModeAndInput() throws Exception {
        SideGitManager m = manager();
        Files.writeString(tempDir.resolve("project").resolve("a.txt"), "v1");
        m.preTurnSnapshot("react-1", "mode=react\ninput=帮我改下登录逻辑");

        String summary = m.preTurnTarget(1).orElseThrow().summary();
        assertTrue(summary.contains("mode=react"), "丢了 mode:" + summary);
        assertTrue(summary.contains("input=帮我改下登录逻辑"), "丢了 input,面板的「当时输入」会是空的:" + summary);
    }

    @Test
    void previewEmptyWhenOffsetOutOfRange() throws Exception {
        SideGitManager m = manager();
        Files.writeString(tempDir.resolve("project").resolve("a.txt"), "v1");
        m.preTurnSnapshot("turn-1", "唯一一次");
        assertTrue(m.preTurnTarget(5).isEmpty(), "越界应为空,而不是硬取到别的快照");
        // 与实际恢复的失败判定保持一致
        assertTrue(!m.restorePreTurn(5).success());
    }
}
