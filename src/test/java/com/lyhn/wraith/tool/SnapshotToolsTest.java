package com.lyhn.wraith.tool;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.hitl.HitlHandler;
import com.lyhn.wraith.hitl.HitlToolRegistry;
import com.lyhn.wraith.snapshot.SideGitManager;
import com.lyhn.wraith.snapshot.SnapshotConfig;
import com.lyhn.wraith.snapshot.SnapshotService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 快照能力的对称性:agent 此前**只有** revert_turn(销毁性、按序号盲操作),
 * 却没有任何只读查看手段 —— 面板有 snapshot.list / status,它一个都没有。
 * 后果:它答不出「当前处于哪个快照」,更无法在回滚前说清将丢掉什么;
 * 唯一的护栏 HITL 也因此只显示 `revert_turn {offset:3}`,等于盲批。
 */
class SnapshotToolsTest {

    /** 捕获审批请求后一律拒绝,绝不真正回滚。 */
    static class CapturingHandler implements HitlHandler {
        ApprovalRequest captured;
        @Override public boolean isEnabled() { return true; }
        @Override public void setEnabled(boolean enabled) {}
        @Override public ApprovalResult requestApproval(ApprovalRequest request) {
            captured = request;
            return ApprovalResult.reject("test");
        }
        @Override public boolean isApprovedAllByTool(String toolName) { return false; }
        @Override public boolean isApprovedAllByServer(String serverName) { return false; }
        @Override public void clearApprovedAll() {}
        @Override public void clearApprovedAllForServer(String serverName) {}
    }

    private static SnapshotService serviceFor(Path project, Path snapshots) {
        return new SnapshotService(new SideGitManager(project,
                new SnapshotConfig(true, snapshots, 50, List.of(".git", "target"))));
    }

    /** 造 3 轮 pre-turn 快照,summary 用真实格式(mode=…\ninput=…)。 */
    private static SnapshotService seeded(Path dir) throws Exception {
        Path project = dir.resolve("project");
        Files.createDirectories(project);
        SnapshotService svc = serviceFor(project, dir.resolve("snapshots"));
        for (String[] t : new String[][]{{"t1", "改 Sidebar"}, {"t2", "修 QQ 队列"}, {"t3", "加快照工具"}}) {
            Files.writeString(project.resolve("a.txt"), t[0]);
            svc.snapshotBeforeTurn(t[0], "mode=react\ninput=" + t[1]);
        }
        return svc;
    }

    private static ToolRegistry registry(Path dir, SnapshotService svc) {
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(dir.resolve("project").toString());
        reg.setSnapshotService(svc);
        return reg;
    }

    // ── 只读:列快照 ──────────────────────────────────────────────────────
    @Test
    void snapshotListReturnsIdsTimesAndInputs(@TempDir Path dir) throws Exception {
        String out = registry(dir, seeded(dir)).executeTool("snapshot_list", "{}");
        assertFalse(out.startsWith("snapshot_list 失败"), out);
        assertTrue(out.contains("改 Sidebar"), "应能看到当时的输入,否则列表等于没信息:" + out);
        assertTrue(out.contains("加快照工具"), out);
        assertTrue(out.contains("pre-turn"), "应标明阶段:" + out);
    }

    @Test
    void snapshotListOnEmptyStoreSaysSoInsteadOfFailing(@TempDir Path dir) throws Exception {
        Path project = dir.resolve("project");
        Files.createDirectories(project);
        String out = registry(dir, serviceFor(project, dir.resolve("snapshots"))).executeTool("snapshot_list", "{}");
        assertFalse(out.startsWith("snapshot_list 失败"), out);
        assertTrue(out.contains("没有") || out.contains("暂无"), "空态要说清,而不是给个空串:" + out);
    }

    // ── 只读:当前状态(截图里那个问题) ─────────────────────────────────
    @Test
    void snapshotStatusAnswersWhereWeAre(@TempDir Path dir) throws Exception {
        String out = registry(dir, seeded(dir)).executeTool("snapshot_status", "{}");
        // ⚠ 必须先排掉「未知工具」:否则 executeTool 对不存在的工具返回
        // "未知工具: snapshot_status",既不以 "失败" 开头、长度也够,断言会恒真。
        assertFalse(out.startsWith("未知工具"), "工具没注册:" + out);
        assertFalse(out.startsWith("snapshot_status 失败"), out);
        assertTrue(out.length() > 5, "状态不能是空的:" + out);
    }

    // ── 只读工具不得进 HITL ────────────────────────────────────────────
    @Test
    void readOnlySnapshotToolsAreNotGatedByApproval(@TempDir Path dir) throws Exception {
        CapturingHandler h = new CapturingHandler();
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.resolve("project").toString());
        reg.setSnapshotService(seeded(dir));
        // 同理:未注册的工具压根不会走审批路径,断言会恒真 —— 先确认它们真的存在。
        assertFalse(reg.executeTool("snapshot_list", "{}").startsWith("未知工具"), "snapshot_list 未注册");
        assertFalse(reg.executeTool("snapshot_status", "{}").startsWith("未知工具"), "snapshot_status 未注册");
        reg.executeToolOutput("snapshot_list", "{}");
        reg.executeToolOutput("snapshot_status", "{}");
        assertTrue(h.captured == null, "只读查看不该要审批,那会让人懒得看");
    }

    // ── 审批预览:把序号变成人话 ────────────────────────────────────────
    @Test
    void revertApprovalPreviewNamesTheTargetSnapshot(@TempDir Path dir) throws Exception {
        CapturingHandler h = new CapturingHandler();
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.resolve("project").toString());
        reg.setSnapshotService(seeded(dir));

        reg.executeToolOutput("revert_turn", "{\"offset\":2}");

        assertNotNull(h.captured, "revert_turn 必须过审批");
        String preview = h.captured.beforeContent();
        assertNotNull(preview, "审批卡没有任何预览 —— 用户只看到 offset:2,等于盲批");
        // offset=2 → 倒数第二个 pre-turn = 「修 QQ 队列」那轮
        assertTrue(preview.contains("修 QQ 队列"),
                "预览须点明将回到哪一轮之前,实际: " + preview);
        assertFalse(preview.contains("加快照工具"),
                "预览指向了错误的快照(最近那轮),会让用户批错: " + preview);
    }

    @Test
    void revertApprovalPreviewSaysSoWhenOffsetOutOfRange(@TempDir Path dir) throws Exception {
        CapturingHandler h = new CapturingHandler();
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.resolve("project").toString());
        reg.setSnapshotService(seeded(dir));

        reg.executeToolOutput("revert_turn", "{\"offset\":99}");

        assertNotNull(h.captured);
        String preview = h.captured.beforeContent();
        assertTrue(preview == null || preview.contains("找不到"),
                "越界时不能假装有目标,实际: " + preview);
    }
}
