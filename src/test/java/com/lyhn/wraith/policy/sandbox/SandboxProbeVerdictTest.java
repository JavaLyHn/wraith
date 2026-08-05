package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「期望失败」的探针<b>不能把「沙箱自己没起来」当成「围栏生效」</b>。
 *
 * <p><b>起因</b>（用户 Windows 11 实测）：
 * <pre>
 * 探针（工作区 D:\wraith\...）
 *   ✘ stdio 管道               命令失败，exit=252
 *   ✘ 工作区内可写                 本应成功却失败了，exit=252
 *       [sandbox] 启动失败: 使用"4"个参数调用".ctor"时发生异常:"对路径的访问被拒绝。"
 *   ✔ 工作区外拒写（期望失败）           已被拦截（符合预期）   ← 假的
 *   ✔ 断网（期望失败）               已被拦截（符合预期）   ← 假的
 * </pre>
 *
 * <p>四条探针<b>全部</b> exit=252（发射器自己的「管道或进程创建失败」码）——
 * AppContainer 进程根本没起来。可后两条却报「符合预期」：它们是因为**进程创建失败**
 * 而失败的，不是被围栏拦住的。
 *
 * <p><b>这正是这套体检存在的理由，而它自己漏了这个方向。</b>
 * 判据原来是 {@code succeeded == probe.expectSuccess()} —— 对「期望失败」的探针，
 * 任何非零退出码都算通过。于是一个**完全没工作的沙箱**能拿到「围栏均已生效」的结论，
 * 比没有这个工具更糟：它给了一个假的安全感。
 *
 * <p>发射器自身失败用 {@code >= 250} 的码（250 profile / 251 ACL / 252 管道或进程 / 253 参数），
 * 诊断行统一带 {@code [sandbox] } 前缀 —— 两条线索都用上，因为 Seatbelt 那侧没有这套码。
 */
class SandboxProbeVerdictTest {

    private static SandboxDoctor.Probe expectFail(String name) {
        return new SandboxDoctor.Probe(name, "irrelevant", false, null);
    }

    private static SandboxDoctor.Probe expectSuccess(String name) {
        return new SandboxDoctor.Probe(name, "irrelevant", true, null);
    }

    @Test
    @DisplayName("**发射器自己没起来时,期望失败的探针不算通过** —— 用户那次四条全 252 却报两条符合预期")
    void launcherFailureIsNotAFenceVerdict() {
        for (int code : new int[]{250, 251, 252, 253}) {
            SandboxDoctor.Result r = SandboxDoctor.verdict(expectFail("断网（期望失败）"), code, "");
            assertFalse(r.pass(), "exit=" + code + " 是发射器自己失败,不能判成围栏生效: " + r.note());
            assertTrue(r.note().contains("没起来") || r.note().contains("判不了"),
                    "要说清「这条判不了」而不是含糊: exit=" + code + " -> " + r.note());
        }
    }

    @Test
    @DisplayName("诊断前缀也算证据 —— Seatbelt 那侧没有 >=250 这套码")
    void launcherDiagnosticPrefixAlsoDisqualifies() {
        SandboxDoctor.Result r = SandboxDoctor.verdict(expectFail("工作区外拒写（期望失败）"), 1,
                "[sandbox] 启动失败: 使用“4”个参数调用“.ctor”时发生异常:“对路径的访问被拒绝。”");
        assertFalse(r.pass(), r.note());
        assertTrue(r.note().contains("对路径的访问被拒绝") || r.note().contains("启动失败"),
                "原文要带出来,那才是能继续查的东西: " + r.note());
    }

    @Test
    @DisplayName("真的被围栏拦住仍然算通过 —— 修法不能把正常情况也否掉")
    void genuineFenceBlockStillPasses() {
        SandboxDoctor.Result r = SandboxDoctor.verdict(expectFail("断网（期望失败）"), 1, "curl: (6) 无法解析主机");
        assertTrue(r.pass(), r.note());
        assertTrue(r.note().contains("符合预期"), r.note());
    }

    @Test
    @DisplayName("期望成功的探针照旧:0 通过、非 0 失败并带上原文")
    void expectSuccessProbesUnchanged() {
        assertTrue(SandboxDoctor.verdict(expectSuccess("工作区内可写"), 0, "").pass());
        SandboxDoctor.Result bad = SandboxDoctor.verdict(expectSuccess("工作区内可写"), 252, "[sandbox] 启动失败: x");
        assertFalse(bad.pass());
        assertTrue(bad.note().contains("252"), bad.note());
    }

    @Test
    @DisplayName("发射器失败时结论不能是「沙箱工作正常」")
    void conclusionMustNotClaimHealthyWhenLauncherFailed() {
        // 四条探针里只要有一条是发射器失败,整体结论就不该说「均已生效」
        java.util.List<SandboxDoctor.Result> results = java.util.List.of(
                SandboxDoctor.verdict(expectSuccess("工作区内可写"), 252, "[sandbox] 启动失败"),
                SandboxDoctor.verdict(expectFail("断网（期望失败）"), 252, ""));
        assertTrue(results.stream().noneMatch(SandboxDoctor.Result::pass),
                "两条都该判失败: " + results);
    }
}
