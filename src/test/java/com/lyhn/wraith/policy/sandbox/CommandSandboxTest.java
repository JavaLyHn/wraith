package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CommandSandboxTest {

    private static final CommandSandbox.Env MAC_ENV =
            new CommandSandbox.Env("Mac OS X", null, null, null);
    private static final CommandSandbox.Env WIN_ENV = new CommandSandbox.Env(
            "Windows 11", "C:\\Windows\\system32\\cmd.exe",
            "C:\\Users\\LyHn\\.wraith\\sandbox\\appcontainer-run.ps1",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");

    // ──────────────────────────── Seatbelt ────────────────────────────

    @Test
    void sandboxAvailable_wrapsWithSandboxExecAndProfile() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.SEATBELT, false, "/ws", "/tmpd", "/ws/.git", "echo hi", MAC_ENV);

        assertTrue(w.sandboxed());
        assertEquals(SandboxKind.SEATBELT, w.kind());
        assertNull(w.warning());
        List<String> c = w.command();
        assertEquals("/usr/bin/sandbox-exec", c.get(0));
        assertTrue(c.contains("WORKSPACE=/ws"));
        assertTrue(c.contains("GIT_DIR=/ws/.git"));
        assertEquals("-p", c.get(c.size() - 5));
        assertTrue(c.get(c.size() - 4).contains("(deny network*)"), "断网 profile 内联在 -p");
        assertEquals(List.of("bash", "-c", "echo hi"),
                c.subList(c.size() - 3, c.size()), "真实命令走 bash -c 尾部");
    }

    @Test
    void networkAllowed_profileHasNoNetworkDeny() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.SEATBELT, true, "/ws", "/tmpd", "/ws/.git", "curl example.com", MAC_ENV);
        String profile = w.command().get(w.command().size() - 4);
        assertFalse(profile.contains("(deny network*)"));
    }

    @Test
    void networkOverrideOmitsDenyNetworkInProfile() {
        CommandSandbox.Wrapped withNet = CommandSandbox.buildCommand(
                SandboxKind.SEATBELT, true, "/proj", "/tmp", null, "curl example.com", MAC_ENV);
        CommandSandbox.Wrapped noNet = CommandSandbox.buildCommand(
                SandboxKind.SEATBELT, false, "/proj", "/tmp", null, "curl example.com", MAC_ENV);
        assertFalse(String.join("\n", withNet.command()).contains("(deny network*)"));
        assertTrue(String.join("\n", noNet.command()).contains("(deny network*)"));
    }

    // ──────────────────────────── AppContainer ────────────────────────────

    @Test
    @DisplayName("Windows 走 PowerShell 发射器,命令原文交给 -CommandLine")
    void appContainer_goesThroughPowershellLauncher() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.APPCONTAINER, false,
                "D:\\wraith-test", "C:\\Temp", "D:\\wraith-test\\.git", "npm install", WIN_ENV);

        assertTrue(w.sandboxed());
        assertEquals(SandboxKind.APPCONTAINER, w.kind());
        assertNull(w.warning());

        List<String> c = w.command();
        assertTrue(c.get(0).endsWith("powershell.exe"), "首元素应是解析出的 powershell: " + c.get(0));
        assertTrue(c.contains("-NoProfile"), "用户 $PROFILE 会污染命令输出");
        assertTrue(c.contains("Bypass"), "默认 ExecutionPolicy 会直接拒跑 .ps1");
        assertEquals("npm install", c.get(c.size() - 1));
        assertEquals("-CommandLine", c.get(c.size() - 2));
        assertTrue(c.contains(AppContainerCommand.PROFILE_NONET));
        assertFalse(c.contains(AppContainerCommand.PROFILE_NET));
    }

    @Test
    @DisplayName("联网开关切的是 profile —— AppContainer 能力集创建后改不了")
    void appContainer_networkTogglesProfile() {
        CommandSandbox.Wrapped net = CommandSandbox.buildCommand(
                SandboxKind.APPCONTAINER, true, "D:\\ws", "C:\\Temp", "D:\\ws\\.git", "curl x", WIN_ENV);
        assertTrue(net.command().contains(AppContainerCommand.PROFILE_NET));
        assertFalse(net.command().contains(AppContainerCommand.PROFILE_NONET));
    }

    @Test
    @DisplayName(".git 目录要传给发射器 —— 对齐 Seatbelt 的 .git 只读")
    void appContainer_passesGitDirForDenyWrite() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.APPCONTAINER, false, "D:\\ws", "C:\\Temp", "D:\\ws\\.git", "git log", WIN_ENV);
        int i = w.command().indexOf("-GitDir");
        assertTrue(i >= 0, "必须带 -GitDir: " + w.command());
        assertEquals("D:\\ws\\.git", w.command().get(i + 1));
    }

    @Test
    @DisplayName("Windows 上绝不出现 bash")
    void appContainer_neverUsesBash() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.APPCONTAINER, false, "D:\\ws", "C:\\Temp", "D:\\ws\\.git", "dir", WIN_ENV);
        assertFalse(w.command().contains("bash"), w.command().toString());
    }

    // ──────────────────────────── fail-open ────────────────────────────

    @Test
    void notAvailable_failsOpenToPlainBashWithWarning() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.NONE, false, "/ws", "/tmpd", "/ws/.git", "echo hi", MAC_ENV);

        assertFalse(w.sandboxed());
        assertEquals(SandboxKind.NONE, w.kind());
        assertEquals(List.of("bash", "-c", "echo hi"), w.command());
        assertNotNull(w.warning());
        assertTrue(w.warning().contains("沙箱"), "fail-open 应带警告: " + w.warning());
    }

    @Test
    @DisplayName("Windows 无沙箱时 fail-open 到 cmd /c,不是 bash —— 这是此前 Windows 跑不起来的直接原因")
    void notAvailableOnWindows_failsOpenToCmd() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                SandboxKind.NONE, false, "D:\\ws", "C:\\Temp", "D:\\ws\\.git", "dir", WIN_ENV);

        assertFalse(w.sandboxed());
        assertEquals(List.of("C:\\Windows\\system32\\cmd.exe", "/c", "dir"), w.command());
        assertFalse(w.command().contains("bash"));
    }

    @Test
    @DisplayName("降级文案要说清这个平台上还剩什么在保护你")
    void warningNamesRemainingDefenses() {
        String mac = CommandSandbox.noSandboxWarning("Mac OS X");
        String win = CommandSandbox.noSandboxWarning("Windows 11");
        assertTrue(mac.contains("命令黑名单"), mac);
        assertTrue(win.contains("命令黑名单"), win);
        assertTrue(win.contains("doctor"), "Windows 上应指出自查手段: " + win);
        assertNotEquals(mac, win, "两个平台缺的东西不同,文案不该一样");
    }

    // ──────────────────────────── detect ────────────────────────────

    @Test
    void detect_macWithSeatbelt() {
        assertEquals(SandboxKind.SEATBELT, CommandSandbox.detect("Mac OS X", true, false));
    }

    @Test
    @DisplayName("mac 上 sandbox-exec 不可执行 → NONE(这是可修的异常,与平台不支持不同)")
    void detect_macWithoutSeatbelt() {
        assertEquals(SandboxKind.NONE, CommandSandbox.detect("Mac OS X", false, false));
    }

    @Test
    void detect_windowsWithAppContainer() {
        assertEquals(SandboxKind.APPCONTAINER, CommandSandbox.detect("Windows 11", false, true));
    }

    @Test
    void detect_windowsWithoutAppContainer() {
        assertEquals(SandboxKind.NONE, CommandSandbox.detect("Windows 11", false, false));
    }

    @Test
    @DisplayName("Linux 恒 NONE —— 没有对应实现")
    void detect_linux() {
        assertEquals(SandboxKind.NONE, CommandSandbox.detect("Linux", true, true));
    }

    @Test
    void constructorRemembersNetworkFlag() {
        assertTrue(new CommandSandbox(true).networkAllowed());
        assertFalse(new CommandSandbox(false).networkAllowed());
    }

    @Test
    void availableIsFalseOnNonMacPlatform() {
        String prev = System.getProperty("os.name");
        try {
            System.setProperty("os.name", "Linux");
            assertFalse(CommandSandbox.available(),
                    "Linux 无任何沙箱实现,应报告不可用");
        } finally {
            if (prev == null) System.clearProperty("os.name");
            else System.setProperty("os.name", prev);
        }
    }
}
