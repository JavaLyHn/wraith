package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ShellCommand} 的分派与编码判定。
 *
 * <p>环境全注入，所以这些 Windows 分支能在 macOS 上跑——与 {@code StdioCommandTest} 同一套路。
 */
class ShellCommandTest {

    private static final String WIN = "Windows 11";
    private static final String MAC = "Mac OS X";
    private static final String COMSPEC = "C:\\Windows\\system32\\cmd.exe";

    // ---------- shell 分派 ----------

    @Test
    @DisplayName("Windows 走 ComSpec /c —— 不再赌 bash.exe 在 PATH")
    void windowsUsesComSpec() {
        List<String> cmd = ShellCommand.wrap(WIN, COMSPEC, "npm install");
        assertEquals(List.of(COMSPEC, "/c", "npm install"), cmd);
    }

    @Test
    @DisplayName("Windows 上 bash 不该出现在命令行里")
    void windowsNeverUsesBash() {
        List<String> cmd = ShellCommand.wrap(WIN, COMSPEC, "dir");
        assertFalse(cmd.contains("bash"), "Windows 分支不该回退到 bash: " + cmd);
        assertFalse(cmd.contains("-c"), "POSIX 的 -c 不该出现在 cmd.exe 命令行里: " + cmd);
    }

    @Test
    @DisplayName("ComSpec 缺失退到裸名 cmd.exe,交给 PATH 解析")
    void windowsFallsBackToBareCmd() {
        assertEquals(List.of("cmd.exe", "/c", "dir"), ShellCommand.wrap(WIN, null, "dir"));
        assertEquals(List.of("cmd.exe", "/c", "dir"), ShellCommand.wrap(WIN, "   ", "dir"));
    }

    @Test
    @DisplayName("非 Windows 保持 bash -c —— 老行为不许变")
    void posixKeepsBash() {
        assertEquals(List.of("bash", "-c", "ls -la"), ShellCommand.wrap(MAC, null, "ls -la"));
        assertEquals(List.of("bash", "-c", "ls -la"), ShellCommand.wrap("Linux", null, "ls -la"));
    }

    @Test
    @DisplayName("命令原样透传,不做任何手工加引号")
    void commandPassedThroughVerbatim() {
        // 手工加引号会跟 ProcessBuilder 自己的 quote 打架,见 ShellCommand 注释里那段推演
        String tricky = "echo \"hi\" & dir";
        assertEquals(tricky, ShellCommand.wrap(WIN, COMSPEC, tricky).get(2));
        assertEquals(tricky, ShellCommand.wrap(MAC, null, tricky).get(2));
    }

    @Test
    @DisplayName("null 命令不抛,退化成空串")
    void nullCommandTolerated() {
        assertEquals(List.of("cmd.exe", "/c", ""), ShellCommand.wrap(WIN, null, null));
        assertEquals(List.of("bash", "-c", ""), ShellCommand.wrap(MAC, null, null));
    }

    @Test
    @DisplayName("os.name 大小写不敏感")
    void osNameCaseInsensitive() {
        assertTrue(ShellCommand.isWindows("WINDOWS_NT"));
        assertTrue(ShellCommand.isWindows("windows 10"));
        assertFalse(ShellCommand.isWindows("Darwin"));
        assertFalse(ShellCommand.isWindows(null));
    }

    // ---------- 输出编码 ----------

    @Test
    @DisplayName("Windows 用 native.encoding —— 绕开 JEP 400 把默认编码变 UTF-8")
    void windowsUsesNativeEncoding() {
        // 刻意只挑**非 UTF-8** 的字符集:本机默认编码就是 UTF-8,
        // 拿 UTF-8 做断言的话,一个「无条件 return defaultCharset()」的坏实现也能通过
        // —— 那种用例在这台机器上永远变不了红,是空测试。
        assertEquals(Charset.forName("GBK"), ShellCommand.outputCharset(WIN, "GBK"));
        assertEquals(Charset.forName("windows-1252"), ShellCommand.outputCharset(WIN, "windows-1252"));
    }

    @Test
    @DisplayName("非 Windows 保持 JVM 默认编码,行为不变")
    void posixKeepsDefaultCharset() {
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset(MAC, "UTF-8"));
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset("Linux", "GBK"));
    }

    @Test
    @DisplayName("native.encoding 缺失或不认识时退回默认,绝不抛")
    void unknownEncodingFallsBack() {
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset(WIN, null));
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset(WIN, ""));
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset(WIN, "no-such-charset-xyz"));
        // 非法字符集名走的是另一条异常(IllegalCharsetNameException),一并兜住
        assertEquals(Charset.defaultCharset(), ShellCommand.outputCharset(WIN, "!!!"));
    }
}
