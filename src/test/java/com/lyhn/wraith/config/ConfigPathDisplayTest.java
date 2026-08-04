package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 配置路径的<b>展示写法</b>要分平台。
 *
 * <p><b>症状</b>（用户在 Windows 上实测）：模型对他说「现在 {@code ~/.wraith} 为空，
 * 说明可能还没配置过自定义 MCP」。
 *
 * <p><b>路径实现本来是对的</b>：全仓库都走 {@code System.getProperty("user.home")} +
 * {@code Path.of}，在 Windows 上解析成 {@code C:\Users\<名>\.wraith}，能读能写。
 * 错的是<b>我们告诉模型和用户的写法</b>，而它有一条真实的伤害链：
 * <ol>
 *   <li>prompt 语料（{@code capabilities.md}）与各处提示里硬编码 {@code ~/.wraith}</li>
 *   <li>模型照着把它塞进 {@code execute_command}</li>
 *   <li>Windows 上那头是 {@code cmd.exe}，<b>{@code ~} 不展开</b>（PowerShell 才展开）</li>
 *   <li>于是拿到空结果 → 模型对用户宣布「{@code ~/.wraith} 为空」</li>
 * </ol>
 * 一个存在且非空的目录被报成空的 —— 又一句错误的事实陈述，而用户没法看出它是编的。
 *
 * <p><b>为什么 Windows 用 {@code %USERPROFILE%}</b>：它在 {@code cmd.exe} 里能展开，
 * 而 {@code cmd.exe} 正是 {@code execute_command} 在 Windows 上用的 shell
 * （见 {@code PromptAssembler.runtimeContext} 里那段 shell 说明）。写 {@code ~} 则两头都不对：
 * cmd 不认，用户也不知道该去哪。
 *
 * <p>模型面前另有一条更硬的保障：prompt 的 Runtime Context 会带上<b>绝对路径</b>
 * （{@link ConfigPathDisplay#absoluteHome()}），根本不需要任何展开。
 */
class ConfigPathDisplayTest {

    private static final String WIN_HOME = "C:\\Users\\lyhn";
    private static final String NIX_HOME = "/Users/lyhn";

    @Test
    @DisplayName("Unix 用 ~/.wraith")
    void unixUsesTilde() {
        assertEquals("~/.wraith", ConfigPathDisplay.home("Mac OS X", NIX_HOME, null));
        assertEquals("~/.wraith", ConfigPathDisplay.home("Linux", NIX_HOME, null));
    }

    @Test
    @DisplayName("Windows 用 %USERPROFILE%\\.wraith —— cmd.exe 里能展开,~ 不能")
    void windowsUsesUserProfile() {
        String s = ConfigPathDisplay.home("Windows 11", WIN_HOME, null);
        assertEquals("%USERPROFILE%\\.wraith", s);
        assertFalse(s.contains("~"), "Windows 上不该出现 ~: " + s);
    }

    @Test
    @DisplayName("子路径按平台分隔符拼")
    void subPathsUseThePlatformSeparator() {
        assertEquals("~/.wraith/mcp.json",
                ConfigPathDisplay.pathIn("Mac OS X", NIX_HOME, null, "mcp.json"));
        assertEquals("%USERPROFILE%\\.wraith\\mcp.json",
                ConfigPathDisplay.pathIn("Windows 11", WIN_HOME, null, "mcp.json"));
        assertEquals("%USERPROFILE%\\.wraith\\skills\\my-skill",
                ConfigPathDisplay.pathIn("Windows 11", WIN_HOME, null, "skills", "my-skill"));
    }

    @Test
    @DisplayName("-Dwraith.config.dir 覆盖时原样显示那个路径 —— 不套任何简写")
    void overrideIsShownVerbatim() {
        assertEquals("/tmp/probe-home",
                ConfigPathDisplay.home("Mac OS X", NIX_HOME, "/tmp/probe-home"));
        assertEquals("D:\\wraith-conf",
                ConfigPathDisplay.home("Windows 11", WIN_HOME, "D:\\wraith-conf"));
        // 覆盖 + 子路径:仍按平台分隔符接上去
        assertEquals("/tmp/probe-home/mcp.json",
                ConfigPathDisplay.pathIn("Mac OS X", NIX_HOME, "/tmp/probe-home", "mcp.json"));
    }

    @Test
    @DisplayName("空白覆盖值视为没覆盖 —— 别把提示变成一个空路径")
    void blankOverrideIsIgnored() {
        assertEquals("~/.wraith", ConfigPathDisplay.home("Mac OS X", NIX_HOME, "   "));
        assertEquals("~/.wraith", ConfigPathDisplay.home("Mac OS X", NIX_HOME, ""));
    }

    @Test
    @DisplayName("绝对路径版:给模型用,不含任何需要展开的记号")
    void absoluteFormNeedsNoExpansion() {
        String win = ConfigPathDisplay.absoluteHome("Windows 11", WIN_HOME, null);
        assertEquals("C:\\Users\\lyhn\\.wraith", win);
        assertFalse(win.contains("~"), win);
        assertFalse(win.contains("%"), win);

        assertEquals("/Users/lyhn/.wraith", ConfigPathDisplay.absoluteHome("Mac OS X", NIX_HOME, null));
        assertEquals("/tmp/x", ConfigPathDisplay.absoluteHome("Mac OS X", NIX_HOME, "/tmp/x"));
    }

    @Test
    @DisplayName("「Darwin」含 win,不能据此判为 Windows —— 与 ShellCommand 共用同一判定")
    void darwinIsNotWindows() {
        assertEquals("~/.wraith", ConfigPathDisplay.home("Darwin", NIX_HOME, null));
    }

    @Test
    @DisplayName("生产入口不抛:user.home 缺失(极端 JVM)也要给出可读的东西")
    void productionEntryPointsAreSafe() {
        assertTrue(ConfigPathDisplay.home().contains(".wraith")
                        || !ConfigPathDisplay.home().isBlank(),
                ConfigPathDisplay.home());
        assertFalse(ConfigPathDisplay.path("mcp.json").isBlank());
        assertFalse(ConfigPathDisplay.absoluteHome().isBlank());
    }

    @Test
    @DisplayName("home 为空时退化成裸 .wraith,不吐出 null/.wraith 这种字面量")
    void missingHomeDegradesGracefully() {
        assertEquals(".wraith", ConfigPathDisplay.absoluteHome("Mac OS X", null, null));
        assertEquals(".wraith", ConfigPathDisplay.absoluteHome("Mac OS X", "  ", null));
    }
}
