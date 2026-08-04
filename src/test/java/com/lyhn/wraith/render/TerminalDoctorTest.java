package com.lyhn.wraith.render;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code wraith terminal doctor}。
 *
 * <p>它存在的唯一理由：开发在 mac，而 Windows 上「JLine 到底拿到了什么终端、
 * 哪个 provider 失败、为什么失败」此前<b>完全不可观测</b>。这份报告是把答案带回来的载具，
 * 所以测试盯的是「关键事实一个都不能少」。
 */
class TerminalDoctorTest {

    @Test
    void recognisesItsOwnCommand() {
        assertTrue(TerminalDoctor.isCommand(new String[]{"terminal"}));
        assertTrue(TerminalDoctor.isCommand(new String[]{"terminal", "doctor"}));
        assertTrue(TerminalDoctor.isCommand(new String[]{"TERMINAL"}));
        assertFalse(TerminalDoctor.isCommand(new String[]{"sandbox", "doctor"}));
        assertFalse(TerminalDoctor.isCommand(new String[]{}));
        assertFalse(TerminalDoctor.isCommand(null));
    }

    @Test
    @DisplayName("报告里必须有定位问题所需的每一项事实 —— 少一项就得让用户再跑一次")
    void reportCarriesEveryFactNeededToDiagnose() {
        String text = String.join("\n", TerminalDoctor.report(StandardCharsets.UTF_8));
        // 环境
        assertTrue(text.contains("os.name"), text);
        assertTrue(text.contains("java.version"), text);
        assertTrue(text.contains("22"), "必须点出 ffm 需要 JDK 22+");
        assertTrue(text.contains("控制台编码"), text);
        // 关键环境变量(判 ANSI 证据用的那几个)
        for (String key : List.of("TERM", "WT_SESSION", "ConEmuANSI", "ANSICON",
                "TERM_PROGRAM", "COLORTERM", "WRAITH_FORCE_ANSI")) {
            assertTrue(text.contains(key), "报告里缺少 " + key);
        }
        // JLine 实况
        assertTrue(text.contains("实现类"), text);
        assertTrue(text.contains("type"), text);
        assertTrue(text.contains("provider"), text);
        // 能力判定四项
        assertTrue(text.contains("原生终端控制"), text);
        assertTrue(text.contains("ANSI 转义序列"), text);
        assertTrue(text.contains("inline 渲染器"), text);
        assertTrue(text.contains("常驻状态栏"), text);
        // 逃生阀
        assertTrue(text.contains("WRAITH_RENDERER=plain"), text);
        assertTrue(text.contains("org.jline.terminal.providers"), text);
    }

    @Test
    @DisplayName("**降级时要把「行编辑失灵」写在能力行旁边** —— 那是用户真正感觉到的症状")
    void reportTiesDumbToTheSymptomTheUserFeels() {
        // surefire 下 stdin 不是 TTY,必然降级,正好覆盖这条路径
        String text = String.join("\n", TerminalDoctor.report(StandardCharsets.UTF_8));
        if (text.contains("原生终端控制     ❌ 无")) {
            assertTrue(text.contains("行编辑"), "降级了却没提行编辑: " + text);
        }
    }

    @Test
    @DisplayName("GBK 下报告不能带无法编码的字符 —— 否则诊断本身就是一片 ?")
    void reportIsRenderableUnderGbk() {
        Charset gbk = Charset.forName("GBK");
        for (String line : TerminalDoctor.report(gbk)) {
            String safe = com.lyhn.wraith.util.ConsoleSafeText.render(line, gbk);
            assertTrue(gbk.newEncoder().canEncode(safe),
                    "这一行在 GBK 下编码不了: " + line);
        }
    }

    @Test
    @DisplayName("GBK 时报告要主动说明「输出会降级为 ASCII」 —— 否则用户以为是乱码 bug")
    void reportMentionsAsciiFallbackWhenEncodingIsNarrow() {
        String text = String.join("\n", TerminalDoctor.report(Charset.forName("GBK")));
        assertTrue(text.contains("降级") && text.contains("ASCII"), text);
    }

    @Test
    void consoleEncodingIsNeverNull() {
        assertTrue(TerminalDoctor.consoleEncoding() != null);
    }

    @Test
    void windowsDetectionUsesPrefixNotContains() {
        assertTrue(TerminalDoctor.isWindows("Windows 11"));
        // "Darwin" 含 "win" —— 用 contains 判会把 mac 认成 Windows
        assertFalse(TerminalDoctor.isWindows("Darwin"));
        assertFalse(TerminalDoctor.isWindows("Mac OS X"));
        assertFalse(TerminalDoctor.isWindows(null));
    }

    @Test
    @DisplayName("`wraith terminal <乱七八糟>` 给用法而不是当 doctor 跑")
    void rejectsUnknownSubcommand() {
        assertEquals(2, TerminalDoctor.run(new String[]{"terminal", "nonsense"}));
    }
}
