package com.lyhn.wraith.snapshot;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 用户 Windows 实测拿到的全部信息就是这两行：
 * <pre>
 * [!] pre-turn 快照失败: Exception caught
 * [!] post-turn 快照失败: Exception caught during execution of add command
 * </pre>
 * <b>什么都没说。</b> 第二句是 JGit {@code AddCommand} 的顶层消息，真正的原因在
 * {@code cause} 里，而旧代码只打了 {@code e.getMessage()}。
 */
class SnapshotFailureReportTest {

    /** 复刻 JGit 的真实形态：顶层笼统，cause 才有内容。 */
    private static Throwable jgitStyle(String realCause) {
        return new RuntimeException("Exception caught during execution of add command",
                new IOException(realCause));
    }

    @Test
    @DisplayName("**cause 链必须展开** —— 只看第一层等于什么都没看,这就是那次白丢诊断的原因")
    void expandsTheCauseChain() {
        String out = SnapshotFailureReport.chain(
                jgitStyle("Filename too long: D:\\wraith\\desktop\\release\\win-unpacked\\...\\x.js"));
        assertTrue(out.contains("Exception caught during execution of add command"), out);
        assertTrue(out.contains("←"), "要有链的连接符,看得出层级: " + out);
        assertTrue(out.contains("IOException"), out);
        assertTrue(out.contains("Filename too long"), "真正的原因必须出现: " + out);
        assertTrue(out.contains("x.js"), "文件名要留着,那是唯一能定位的东西: " + out);
    }

    @Test
    @DisplayName("**环形 cause 不能死循环** —— 靠深度上限,不是靠自引用检查")
    void cyclicCauseChainIsBounded() {
        // Java 不允许 initCause(this)("Self-causation not permitted"),
        // 但 A→B→A 这种更长的环**不被 JVM 拦**,所以真正的防线是深度上限。
        RuntimeException a = new RuntimeException("outer");
        RuntimeException b = new RuntimeException("inner", a);
        a.initCause(b);
        String out = SnapshotFailureReport.chain(a);
        assertTrue(out.contains("outer") && out.contains("inner"), out);
        assertTrue(out.length() < 400, "深度上限该把它截住,而不是无限展开: 长度 " + out.length());
        // actionableHint 走另一条遍历,同样要有上限
        assertEquals("", SnapshotFailureReport.actionableHint(a));
    }

    @Test
    void nullIsSafe() {
        assertEquals("(无异常对象)", SnapshotFailureReport.chain(null));
    }

    // ── 可行动建议:只在能确定的形态上说话 ────────────────────────────────

    @Test
    @DisplayName("路径过长 → 指向 260 字符上限与排除办法")
    void hintsAtWindowsPathLimit() {
        String h = SnapshotFailureReport.actionableHint(jgitStyle("Filename too long"));
        assertTrue(h.contains("260"), h);
        assertTrue(h.contains("WRAITH_SNAPSHOT_EXCLUDES"), h);
    }

    @Test
    @DisplayName("文件被占用 / 拒绝访问 → 点出杀软与索引器,中英文消息都要认")
    void hintsAtFileLocking() {
        for (String msg : new String[]{
                "The process cannot access the file because it is being used by another process",
                "另一个程序正在使用此文件",
                "Access is denied",
                "拒绝访问。"}) {
            String h = SnapshotFailureReport.actionableHint(jgitStyle(msg));
            assertFalse(h.isEmpty(), "该认出来: " + msg);
            assertTrue(h.contains("占用") || h.contains("权限"), msg + " -> " + h);
        }
    }

    @Test
    @DisplayName("index.lock → 指出多半是上次被强杀留下的")
    void hintsAtStaleIndexLock() {
        String h = SnapshotFailureReport.actionableHint(jgitStyle("Cannot lock index.lock"));
        assertTrue(h.contains("index.lock"), h);
    }

    @Test
    @DisplayName("磁盘满 → 指向 /snapshot clean")
    void hintsAtDiskFull() {
        String h = SnapshotFailureReport.actionableHint(jgitStyle("No space left on device"));
        assertTrue(h.contains("/snapshot clean"), h);
    }

    @Test
    @DisplayName("**认不出来的形态一律不猜** —— 猜错方向比不给建议更浪费时间")
    void staysSilentOnUnknownShapes() {
        assertEquals("", SnapshotFailureReport.actionableHint(jgitStyle("something we have never seen")));
        assertEquals("", SnapshotFailureReport.actionableHint(null));
    }

    // ── 整体输出 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("完整输出:阶段名 + cause 链 + 建议 + **怎么关掉**")
    void describeCarriesEverythingIncludingHowToSilenceIt() {
        String out = SnapshotFailureReport.describe("pre-turn", jgitStyle("Filename too long"));
        assertTrue(out.contains("pre-turn"), out);
        assertTrue(out.contains("Filename too long"), out);
        assertTrue(out.contains("260"), out);
        // 快照失败不阻塞对话,但每轮刷两行很吵 —— 必须告诉用户怎么让它安静
        assertTrue(out.contains("WRAITH_SNAPSHOT_ENABLED=false"), out);
    }

    @Test
    @DisplayName("认不出原因时仍然给「怎么关掉」和原文 —— 不能只留一句无用的顶层消息")
    void describeStillUsefulWhenCauseIsUnknown() {
        String out = SnapshotFailureReport.describe("post-turn", jgitStyle("weird internal state"));
        assertTrue(out.contains("weird internal state"), out);
        assertTrue(out.contains("WRAITH_SNAPSHOT_ENABLED=false"), out);
    }
}
