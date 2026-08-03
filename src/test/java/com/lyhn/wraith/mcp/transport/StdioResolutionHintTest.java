package com.lyhn.wraith.mcp.transport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Windows 上 {@code npx} 解析失败时，报错里必须留下「wraith 找过、没找到」这条线索。
 *
 * <p><b>症状</b>（用户 Windows 截图）：添加 filesystem server 点测试，只看到
 * {@code JSON-RPC request timed out: initialize} + cmd.exe 的「系统找不到指定的文件。」。
 *
 * <p>解析机制本身是好的：{@code AppServerMcp.test} → {@code new StdioTransport} →
 * {@code StdioCommand.build}，Windows 上会按 PATH × PATHEXT 把 {@code npx} 解析成
 * {@code npx.cmd}。{@code StdioCommand} 原本的取舍是「解析不到就原样交给 OS，让它报自己的错，
 * 那比我们编一句『找不到 npx』更准」——这个判断讲得通，但代价是丢掉了最有用的一条信息，
 * 因为它区分了两种处境完全不同的情况：
 *
 * <ul>
 *   <li>Node 没装 / 不在 PATH → 用户该去装 Node</li>
 *   <li><b>装了，但 wraith 继承的是旧 PATH</b>（装完 Node 没重启 wraith，或用 nvm-windows 装的）
 *       → 用户该<b>重启 wraith</b>。这一种在 Windows 上极常见，而原来的报错完全指不出来</li>
 * </ul>
 *
 * <p>所以不抢 OS 的准确性，只在解析失败时<b>追加</b>一句诊断。
 */
class StdioResolutionHintTest {

    private static final String WINDOWS = "Windows 11";
    private static final String PATHEXT = ".COM;.EXE;.BAT;.CMD";

    /**
     * PATH 上「存在」的文件集合，注入代替真实文件系统。
     *
     * <p><b>大小写不敏感</b>是刻意的：{@code resolveOnWindows} 用 {@code PATHEXT} 的原样大小写
     * 去探（默认值是 {@code .COM;.EXE;.BAT;.CMD}，全大写），而真实 Windows 文件系统
     * 大小写不敏感，所以 {@code Files.isRegularFile("…\\npx.CMD")} 能匹配到磁盘上的
     * {@code npx.cmd}。用大小写敏感的 Set 会让这个测试假红 —— 我第一版就是这么错的。
     */
    private static java.util.function.Predicate<String> existing(String... paths) {
        Set<String> lower = java.util.Arrays.stream(paths)
                .map(p -> p.toLowerCase(java.util.Locale.ROOT))
                .collect(java.util.stream.Collectors.toSet());
        return p -> lower.contains(p.toLowerCase(java.util.Locale.ROOT));
    }

    @Test
    @DisplayName("Windows 上解析不到时，追加的诊断要点名 PATH 与「重启 wraith」")
    void hintNamesPathAndRestartWhenUnresolvedOnWindows() {
        String hint = StdioCommand.windowsResolutionHint(
                "npx", WINDOWS, "C:\\Windows\\System32", PATHEXT, existing());

        assertTrue(hint.contains("npx"), hint);
        assertTrue(hint.contains("PATH"), "得说清是在 PATH 上没找到: " + hint);
        assertTrue(hint.contains("重启"), "最常见的因是继承了旧 PATH,必须提重启: " + hint);
    }

    @Test
    @DisplayName("解析得到时不追加任何东西 —— 别在能跑的情况下制造噪音")
    void noHintWhenResolvable() {
        java.util.function.Predicate<String> exists = existing("C:\\nodejs\\npx.cmd");

        assertEquals("", StdioCommand.windowsResolutionHint(
                "npx", WINDOWS, "C:\\nodejs", PATHEXT, exists));
        // 同一份输入下 build() 也确实解析到了,两者必须一致,否则提示与实际行为脱节。
        // 大小写不比:解析出来的后缀跟着 PATHEXT 的原样大小写(默认全大写 .CMD),
        // Windows 文件系统不在乎 —— 把大小写写进断言只会得到一条假红(我第二版就是这么错的)。
        assertEquals("c:\\nodejs\\npx.cmd",
                StdioCommand.build("npx", List.of(), WINDOWS, "C:\\nodejs", PATHEXT, exists)
                        .get(0).toLowerCase(java.util.Locale.ROOT));
    }

    @Test
    @DisplayName("非 Windows 不追加 —— 那边 PATHEXT 这套根本不适用")
    void noHintOnNonWindows() {
        assertEquals("", StdioCommand.windowsResolutionHint(
                "npx", "Mac OS X", "/usr/local/bin", null, existing()));
        assertEquals("", StdioCommand.windowsResolutionHint(
                "npx", "Linux", "/usr/bin", null, existing()));
    }

    @Test
    @DisplayName("已经是绝对路径 / 带后缀的命令解析不到时也给提示，但话术不该只提 npx")
    void hintWorksForAnyCommandName() {
        String hint = StdioCommand.windowsResolutionHint(
                "uvx", WINDOWS, "C:\\Windows\\System32", PATHEXT, existing());

        assertTrue(hint.contains("uvx"), "提示要点名用户实际填的那个命令: " + hint);
    }

    @Test
    @DisplayName("命令为空 / PATH 为空时不炸")
    void emptyInputsAreSafe() {
        assertEquals("", StdioCommand.windowsResolutionHint(null, WINDOWS, null, null, existing()));
        assertEquals("", StdioCommand.windowsResolutionHint("", WINDOWS, "", "", existing()));
    }
}
