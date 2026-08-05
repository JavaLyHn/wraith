package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 发射器给匿名管道设的 DACL <b>必须同时授权创建者自己</b>。
 *
 * <p><b>起因</b>（用户 Windows 11 实测，四条探针全 exit=252）：
 * <pre>
 * [sandbox] 启动失败: 使用“4”个参数调用“.ctor”时发生异常:“对路径的访问被拒绝。”
 * </pre>
 *
 * <p>那个「4 个参数的 .ctor」只有一处 ——
 * {@code AnonymousPipeServerStream(PipeDirection, HandleInheritability, int, PipeSecurity)}。
 * 而脚本里的 {@code PipeSecurity} 是这样建的：
 *
 * <pre>
 * $pipeSec = New-Object System.IO.Pipes.PipeSecurity      # ← 空 DACL
 * $pipeSec.AddAccessRule(... $acSid ... FullControl ...)   # ← 只授了 AppContainer SID
 * </pre>
 *
 * <p><b>根因</b>：{@code new PipeSecurity()} 是<b>空 DACL</b>，而显式安全描述符会
 * <b>整体替换默认 DACL</b>。{@code CreatePipe} 建服务端之后要再打开另一端，
 * 那一步是<b>要过访问检查</b>的 —— DACL 里没有创建者，于是 ERROR_ACCESS_DENIED，
 * .NET 把它翻成 {@code UnauthorizedAccessException(“对路径的访问被拒绝”)}。
 * 结果 AppContainer 进程根本没起来，「授权给 AppContainer」这个本意也一起落空。
 *
 * <p><b>这条测试能守什么、不能守什么</b>：它是**文本层不变量**——
 * 保证脚本里确实给创建者也加了 ACE。它<b>不能</b>证明 Windows 上真的跑通了
 * （PowerShell + Win32 只能在真机验）。但这个 bug 本身是纯逻辑错、在脚本文本里就看得见，
 * 而此前所有沙箱测试都只测 Java 侧（版本解析、脚本释放），<b>没有一条看脚本内容</b>——
 * 正好落在盲区里。
 */
class AppContainerPipeSecurityTest {

    private static String script() throws Exception {
        String content = AppContainerSupport.readResource();
        assertNotNull(content, "jar 内缺少 appcontainer-run.ps1");
        return content;
    }

    /**
     * {@code PipeSecurity} 建好到管道构造之间的那一段。
     *
     * <p>结束边界用 <b>{@code $pipe = New-Object}</b>（真正的赋值语句）而不是裸类名
     * {@code AnonymousPipeServerStream} —— 后者会被<b>注释里提到它的地方</b>先命中，
     * 于是块在注释处就截断、ACE 全被切掉。第一版就这么自己咬了自己
     * （脚本里那段解释根因的注释正好写了这个类名）。
     */
    private static String pipeSecurityBlock(String s) {
        int from = s.indexOf("New-Object System.IO.Pipes.PipeSecurity");
        assertTrue(from >= 0, "找不到 PipeSecurity 的创建处 —— 脚本结构变了,这条测试要跟着改");
        int to = s.indexOf("$pipe = New-Object", from);
        assertTrue(to > from, "找不到管道构造语句($pipe = New-Object ...)");
        return s.substring(from, to);
    }

    @Test
    @DisplayName("**显式 DACL 必须包含创建者** —— 否则 CreatePipe 直接 ACCESS_DENIED（用户实测 exit=252）")
    void daclMustGrantTheCreatingProcess() throws Exception {
        String block = pipeSecurityBlock(script());

        assertTrue(block.contains("WindowsIdentity"),
                "DACL 里没有当前身份 —— 空 DACL 只授 AppContainer 会让创建者自己也打不开管道:\n" + block);
        long rules = block.split("AddAccessRule", -1).length - 1;
        assertTrue(rules >= 2,
                "至少要两条 ACE(AppContainer + 创建者),现在只有 " + rules + " 条:\n" + block);
    }

    @Test
    @DisplayName("AppContainer 那条 ACE 不能被顺手删掉 —— 它是这段显式 DACL 存在的理由")
    void appContainerAceStillThere() throws Exception {
        String block = pipeSecurityBlock(script());
        assertTrue(block.contains("$acSid"),
                "AppContainer 的 SID 不在 DACL 里了 —— 那它的令牌读写管道会被拒:\n" + block);
    }

    @Test
    @DisplayName("退出码约定没变 —— SandboxDoctor 靠 >=250 区分「发射器自己失败」")
    void launcherFailureCodesStillDocumented() throws Exception {
        String s = script();
        for (String code : new String[]{"250", "251", "252", "253"}) {
            assertTrue(s.contains(code), "脚本里找不到退出码 " + code + " 的约定");
        }
        assertTrue(s.contains("exit 252"), "管道/进程创建失败仍应退 252");
    }

    @Test
    @DisplayName("诊断行前缀没变 —— SandboxDoctor 也靠它认「发射器自己失败」")
    void diagnosticPrefixStillThere() throws Exception {
        assertTrue(script().contains("[sandbox] "),
                "Write-Diag 的前缀变了,SandboxDoctor.verdict 认不出发射器失败");
    }
}
