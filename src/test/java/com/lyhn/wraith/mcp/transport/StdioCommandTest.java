package com.lyhn.wraith.mcp.transport;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 用户在 Windows 上加 chrome-devtools MCP（`command: npx`）时撞到：
 *
 * <pre>Cannot run program "npx" (in directory "C:\Users\LyHn"):
 * CreateProcess error=2, 系统找不到指定的文件</pre>
 *
 * <p>Node 装了、npx 也在 PATH 里。问题在于 npm 在 Windows 上装出来的是 <b>npx.cmd</b>，
 * 而 {@code CreateProcess} 不像 POSIX 的 {@code execvp} 那样会做 {@code PATHEXT} 补全 ——
 * 没人替 Java 走 shell 那一步。注意错误码是 <b>FILE_NOT_FOUND</b> 而不是格式错，
 * 这正说明卡在「找不到」而非「跑不动」。
 *
 * <p>这些用例在 mac 上验证 Windows 分支：os.name / PATH / PATHEXT / 文件存在性全部注入。
 */
class StdioCommandTest {

    private static final String WIN = "Windows 11";
    private static final String MAC = "Mac OS X";
    private static final String PATH =
            "C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\LyHn\\AppData\\Roaming\\npm";
    private static final String PATHEXT = ".COM;.EXE;.BAT;.CMD";

    /**
     * 假文件系统:只有列出来的路径算存在。
     *
     * ⚠ **必须大小写不敏感** —— 真实 Windows 文件系统就是。第一版用 Set.contains 精确匹配,
     * 结果 PATHEXT 里的 `.CMD`(Windows 惯例大写)对不上 fixture 里的 `npx.cmd`,
     * 6 条用例全红,看着像实现有问题,其实是测试替身不像真环境。
     */
    private static Predicate<String> fs(String... present) {
        Set<String> set = java.util.Arrays.stream(present)
                .map(s -> s.toLowerCase(java.util.Locale.ROOT))
                .collect(java.util.stream.Collectors.toSet());
        return p -> set.contains(p.toLowerCase(java.util.Locale.ROOT));
    }

    /** 解析结果按大小写不敏感比对(PATHEXT 大写 → 拼出的扩展名也是大写,在 Windows 上等价)。 */
    private static void assertPathEquals(String expected, String actual) {
        assertTrue(expected.equalsIgnoreCase(actual), "期望 " + expected + ",实到 " + actual);
    }

    @Test
    void windows_裸名_npx_解析成_npx_cmd_的完整路径() {
        List<String> cmd = StdioCommand.build("npx", List.of("-y", "chrome-devtools-mcp@latest"),
                WIN, PATH, PATHEXT, fs("C:\\Program Files\\nodejs\\npx.cmd"));

        assertPathEquals("C:\\Program Files\\nodejs\\npx.cmd", cmd.get(0));
        assertEquals(List.of("-y", "chrome-devtools-mcp@latest"), cmd.subList(1, cmd.size()),
                "参数必须原样跟在后面");
    }

    @Test
    void 按_PATH_顺序取第一个命中_不能跳到后面的目录() {
        List<String> cmd = StdioCommand.build("npx", List.of(), WIN, PATH, PATHEXT,
                fs("C:\\Program Files\\nodejs\\npx.cmd",
                   "C:\\Users\\LyHn\\AppData\\Roaming\\npm\\npx.cmd"));
        assertPathEquals("C:\\Program Files\\nodejs\\npx.cmd", cmd.get(0));
    }

    @Test
    void 按_PATHEXT_顺序_exe_优先于_cmd() {
        // Windows 自身就是这个优先级;若反了,有 foo.exe 又有 foo.cmd 时会挑错
        List<String> cmd = StdioCommand.build("tool", List.of(), WIN,
                "C:\\bin", ".COM;.EXE;.BAT;.CMD",
                fs("C:\\bin\\tool.cmd", "C:\\bin\\tool.exe"));
        assertPathEquals("C:\\bin\\tool.exe", cmd.get(0));
    }

    @Test
    void PATH_用分号切_不是冒号() {
        // 这是 Windows 移植里最常见的一类错(仓库另一处 npxSearchDirs 就栽在这)。
        // 若按 ':' 切,"C:\\bin" 会被劈成 "C" 和 "\\bin",什么也找不到。
        List<String> cmd = StdioCommand.build("npx", List.of(), WIN,
                "C:\\bin;D:\\other", PATHEXT, fs("D:\\other\\npx.cmd"));
        assertPathEquals("D:\\other\\npx.cmd", cmd.get(0));
    }

    @Test
    void PATHEXT_缺失时用_Windows_默认值兜底() {
        List<String> cmd = StdioCommand.build("npx", List.of(), WIN, "C:\\bin", null,
                fs("C:\\bin\\npx.cmd"));
        assertPathEquals("C:\\bin\\npx.cmd", cmd.get(0));
    }

    @Test
    void 已经带扩展名就不再补_直接按原样找() {
        List<String> cmd = StdioCommand.build("npx.cmd", List.of(), WIN, "C:\\bin", PATHEXT,
                fs("C:\\bin\\npx.cmd"));
        assertPathEquals("C:\\bin\\npx.cmd", cmd.get(0));
    }

    @Test
    void 用户写了绝对路径就尊重它_只在缺扩展名时补() {
        assertPathEquals("C:\\tools\\my.exe",
                StdioCommand.build("C:\\tools\\my.exe", List.of(), WIN, PATH, PATHEXT,
                        fs("C:\\tools\\my.exe")).get(0));
        assertPathEquals("C:\\tools\\my.cmd",
                StdioCommand.build("C:\\tools\\my", List.of(), WIN, PATH, PATHEXT,
                        fs("C:\\tools\\my.cmd")).get(0));
    }

    @Test
    void 解析不到就原样交回去_让系统报它自己的错() {
        // 我们编一句「找不到 npx」反而不如原生错误准确(可能是权限、可能是别的)
        List<String> cmd = StdioCommand.build("npx", List.of("-y"), WIN, PATH, PATHEXT, fs());
        assertEquals("npx", cmd.get(0));
        assertEquals(List.of("-y"), cmd.subList(1, cmd.size()));
    }

    @Test
    void 非_Windows_原样透传_不做任何解析() {
        // POSIX 的 execvp 本就查 PATH;我们插一脚反而可能选错(比如 shim 与真身)
        List<String> cmd = StdioCommand.build("npx", List.of("-y", "pkg"), MAC, PATH, PATHEXT,
                fs("/usr/local/bin/npx"));
        assertEquals(List.of("npx", "-y", "pkg"), cmd);
    }

    @Test
    void Darwin_不能被误判成_Windows() {
        // "Darwin" 里含 "win" —— 旧的 contains("win") 写法在这儿翻车。
        // JVM 在 macOS 上报的是 "Mac OS X" 所以生产上不咬人,但只要有人把
        // `uname -s` 的结果喂进来就会走 Windows 分支去解析 PATHEXT。
        assertFalse(StdioCommand.isWindows("Darwin"));
        assertFalse(StdioCommand.isWindows("darwin"));
        assertTrue(StdioCommand.isWindows("Windows 11"));
    }

    @Test
    void 空参数与_null_参数都不炸() {
        assertEquals(List.of("npx"), StdioCommand.build("npx", null, MAC, null, null, fs()));
        assertEquals(List.of("npx"), StdioCommand.build("npx", List.of(), MAC, null, null, fs()));
    }

    @Test
    void windows_但_PATH_为空时不炸() {
        assertEquals("npx", StdioCommand.build("npx", List.of(), WIN, null, PATHEXT, fs()).get(0));
        assertEquals("npx", StdioCommand.build("npx", List.of(), WIN, "", PATHEXT, fs()).get(0));
    }
}
