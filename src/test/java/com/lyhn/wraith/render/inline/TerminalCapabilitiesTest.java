package com.lyhn.wraith.render.inline;

import org.jline.terminal.Size;
import org.jline.terminal.Terminal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 终端能力探测。
 *
 * <p><b>本文件在 2026-08-04 改过一个核心契约，起因是 Windows 实测</b>：
 * <pre>
 * PS C:\Users\LyHn&gt; wraith
 * ?? 终端不支持 ANSI，inline 模式回退到 plain
 *   &lt;紧接着是带颜色的 WRAITH 大字与青色的 Model 行&gt;
 * </pre>
 * 这句提示<b>自相矛盾</b>——ANSI 明明生效了。根因是把「JLine 给了 DumbTerminal」
 * 当成了「终端不解释 ANSI」，而这两件事无关：
 *
 * <ul>
 *   <li>{@code DumbTerminal} 只意味着 <b>JLine 拿不到原生终端控制</b>
 *       （raw mode / 尺寸 / 信号）。JLine 4.0 的 provider 默认顺序是
 *       {@code ffm,jni,exec}——{@code ffm} 要 JDK 22+（本项目是 17），
 *       {@code exec} 在 Windows 上要 {@code stty}，于是 Windows 上只剩 {@code jni}；
 *       它一旦失败就只能降级。</li>
 *   <li>但<b>终端本身是否解释 ANSI 转义序列</b>是另一回事。Windows Terminal、
 *       ConEmu、VS Code 内置终端全都解释——写进去就有颜色，跟 JLine 拿没拿到
 *       原生控制毫无关系。</li>
 * </ul>
 *
 * <p>所以判据改成：<b>type 是 dumb 时，再看有没有「现代终端」的环境证据</b>。
 * 有证据就允许 inline 渲染（颜色、思考面板、diff 全部回来）；没有才退 plain。
 */
class TerminalCapabilitiesTest {

    private String savedSysProp;

    @BeforeEach
    void save() {
        savedSysProp = System.getProperty("wraith.no.statusbar");
    }

    @AfterEach
    void restore() {
        if (savedSysProp == null) {
            System.clearProperty("wraith.no.statusbar");
        } else {
            System.setProperty("wraith.no.statusbar", savedSysProp);
        }
    }

    private static Terminal typed(String type) {
        Terminal t = Mockito.mock(Terminal.class);
        Mockito.when(t.getType()).thenReturn(type);
        return t;
    }

    @Test
    void nullTerminalIsNotAnsiCapable() {
        assertFalse(TerminalCapabilities.supportsAnsi(null));
    }

    @Test
    void xtermTerminalIsAnsiCapable() {
        assertTrue(TerminalCapabilities.supportsAnsi(typed("xterm-256color")));
    }

    // ── dumb type 的新契约 ──────────────────────────────────────────────────

    @Test
    @DisplayName("**dumb 且在 Windows Terminal 里 → 仍算支持 ANSI** —— 这正是用户撞上的那台机器")
    void dumbTypeInWindowsTerminalIsAnsiCapable() {
        // WT_SESSION 是 Windows Terminal 注入的,截图里的标签页 UI 就是它
        assertTrue(TerminalCapabilities.supportsAnsi(
                "dumb", "Windows 11", Map.of("WT_SESSION", "abc-123")));
    }

    @Test
    @DisplayName("dumb 且拿不到任何现代终端证据 → 保守退 plain")
    void dumbTypeWithoutEvidenceIsNotAnsiCapable() {
        assertFalse(TerminalCapabilities.supportsAnsi("dumb", "Windows 11", Map.of()));
        assertFalse(TerminalCapabilities.supportsAnsi("dumb", "Mac OS X", Map.of()));
    }

    @Test
    @DisplayName("dumb-color 也要按 dumb 处理 —— JLine 有两种 dumb type,只判 \"dumb\" 会漏掉一半")
    void dumbColorTypeIsTreatedAsDumb() {
        assertFalse(TerminalCapabilities.supportsAnsi("dumb-color", "Windows 11", Map.of()));
        assertTrue(TerminalCapabilities.supportsAnsi(
                "dumb-color", "Windows 11", Map.of("WT_SESSION", "x")));
    }

    @Test
    @DisplayName("各家现代终端的证据都认")
    void recognisesEachModernTerminalMarker() {
        for (Map<String, String> env : java.util.List.of(
                Map.of("WT_SESSION", "x"),                    // Windows Terminal
                Map.of("ConEmuANSI", "ON"),                   // ConEmu
                Map.of("ANSICON", "120x1000 (120x30)"),       // ansicon
                Map.of("TERM_PROGRAM", "vscode"),             // VS Code 内置终端
                Map.of("COLORTERM", "truecolor"),
                Map.of("TERM", "xterm-256color"),
                Map.of("TERMINAL_EMULATOR", "JetBrains-JediTerm"))) {
            assertTrue(TerminalCapabilities.supportsAnsi("dumb", "Windows 11", env),
                    "应认出这个证据: " + env);
        }
    }

    @Test
    @DisplayName("ConEmuANSI=OFF 不算证据 —— 那是明确说了「关掉」")
    void conEmuAnsiOffIsNotEvidence() {
        assertFalse(TerminalCapabilities.supportsAnsi(
                "dumb", "Windows 11", Map.of("ConEmuANSI", "OFF")));
    }

    @Test
    @DisplayName("**WRAITH_FORCE_ANSI 是逃生阀,盖过一切** —— 证据清单必然会漏掉某些终端,"
            + "漏掉时用户要能自己强开,而不是等我们改代码发版")
    void forceAnsiOverridesEverything() {
        assertTrue(TerminalCapabilities.supportsAnsi(
                "dumb", "Windows 11", Map.of("WRAITH_FORCE_ANSI", "true")));
        // 连 TERM=dumb 都盖过 —— 用户明确要求了就照办
        assertTrue(TerminalCapabilities.supportsAnsi(
                "dumb", "Linux", Map.of("WRAITH_FORCE_ANSI", "true", "TERM", "dumb")));
        // 值的解析走 Boolean.parseBoolean:只有 "true"(不分大小写)算,"1" 不算。
        // 这一点必须写进文档,否则用户设了 =1 却没生效会以为开关是坏的。
        assertFalse(TerminalCapabilities.supportsAnsi(
                "dumb", "Linux", Map.of("WRAITH_FORCE_ANSI", "1")));
        assertFalse(TerminalCapabilities.supportsAnsi(
                "dumb", "Linux", Map.of("WRAITH_FORCE_ANSI", "no")));
        assertTrue(TerminalCapabilities.supportsAnsi(
                "dumb", "Linux", Map.of("WRAITH_FORCE_ANSI", "TRUE")));
    }

    // ── TERM=dumb 的优先级 ─────────────────────────────────────────────────

    @Test
    @DisplayName("TERM=dumb 一律不支持 —— 那是终端**自己声明**的哑,比 type 更权威")
    void termDumbAlwaysWins() {
        assertFalse(TerminalCapabilities.supportsAnsi(
                "xterm-256color", "Linux", Map.of("TERM", "dumb")));
    }

    @Test
    @DisplayName("**NO_COLOR 不该盖过 TERM=dumb** —— 改之前它会,那是个真缺陷")
    void noColorDoesNotOverrideTermDumb() {
        // 旧实现里 NO_COLOR 的检查在 TERM 之前且直接 return true,于是
        // NO_COLOR + TERM=dumb 被判成「支持 ANSI」。NO_COLOR 的语义只是
        // 「别上颜色」,从来不是「我能解释光标控制序列」。
        assertFalse(TerminalCapabilities.supportsAnsi(
                "xterm-256color", "Linux", Map.of("NO_COLOR", "1", "TERM", "dumb")));
    }

    @Test
    @DisplayName("NO_COLOR 单独出现时仍算支持 —— 它只关颜色,不关光标控制")
    void noColorAloneKeepsAnsiCapability() {
        assertTrue(TerminalCapabilities.supportsAnsi(
                "xterm-256color", "Linux", Map.of("NO_COLOR", "1")));
    }

    // ── scroll region ─────────────────────────────────────────────────────

    @Test
    void scrollRegionRequiresMinimumSize() {
        Terminal small = typed("xterm-256color");
        Mockito.when(small.getSize()).thenReturn(new Size(40, 4));
        assertFalse(TerminalCapabilities.supportsScrollRegion(small));
    }

    @Test
    void scrollRegionTrueOnNormalTerminal() {
        Terminal normal = typed("xterm-256color");
        Mockito.when(normal.getSize()).thenReturn(new Size(120, 40));
        assertTrue(TerminalCapabilities.supportsScrollRegion(normal));
    }

    @Test
    @DisplayName("**dumb 上不开 scroll region,哪怕认了 ANSI** —— DumbTerminal 的尺寸不可信")
    void scrollRegionDisabledOnDumbTerminalEvenWithAnsi() {
        // DumbTerminal 的 getSize() 来自 env COLUMNS/LINES,没有就是 (80,24) 兜底。
        // scroll region(DECSTBM)按错的行数设,状态栏会画到屏幕中间或把正文裁掉 ——
        // 比没有状态栏糟得多。所以 ANSI 可以开,scroll region 不开。
        Terminal dumb = typed("dumb");
        Mockito.when(dumb.getSize()).thenReturn(new Size(120, 40));
        assertFalse(TerminalCapabilities.supportsScrollRegionFor(dumb, "Windows 11",
                Map.of("WT_SESSION", "x")));
        // 同一台机器上 ANSI 是认的 —— 两个能力被分开了
        assertTrue(TerminalCapabilities.supportsAnsi("dumb", "Windows 11", Map.of("WT_SESSION", "x")));
    }

    @Test
    void noStatusbarPropertyDisablesScrollRegion() {
        System.setProperty("wraith.no.statusbar", "true");
        Terminal normal = typed("xterm-256color");
        Mockito.when(normal.getSize()).thenReturn(new Size(120, 40));
        assertFalse(TerminalCapabilities.supportsScrollRegion(normal));
    }

    @Test
    void safeSizeFallbackOnNullSize() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getSize()).thenReturn(null);
        Size size = TerminalCapabilities.safeSize(terminal);
        assertEquals(80, size.getColumns());
        assertEquals(24, size.getRows());
    }

    @Test
    void safeSizeFallbackOnZeroSize() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getSize()).thenReturn(new Size(0, 0));
        Size size = TerminalCapabilities.safeSize(terminal);
        assertEquals(80, size.getColumns());
        assertEquals(24, size.getRows());
    }

    @Test
    @DisplayName("isDumbType 认得 JLine 的两种 dumb,别的都不算")
    void isDumbTypeCoversBothJlineDumbTypes() {
        assertTrue(TerminalCapabilities.isDumbType("dumb"));
        assertTrue(TerminalCapabilities.isDumbType("dumb-color"));
        assertTrue(TerminalCapabilities.isDumbType("DUMB"));
        assertFalse(TerminalCapabilities.isDumbType("xterm"));
        assertFalse(TerminalCapabilities.isDumbType(null));
    }
}
