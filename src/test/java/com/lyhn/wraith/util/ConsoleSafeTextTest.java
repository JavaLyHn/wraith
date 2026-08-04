package com.lyhn.wraith.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Windows 实测症状：
 * <pre>
 * ?? 终端不支持 ANSI，inline 模式回退到 plain
 * </pre>
 * 中文是好的，只有 {@code ⚠️} 变成了 {@code ??} —— 中文 Windows 控制台码页是 GBK/936，
 * 而 {@code ⚠}(U+26A0) 与变体选择符 {@code U+FE0F} 都不在 GBK 里，各降一个 {@code ?}。
 *
 * <p>这跟 {@code WindowsLauncherScriptTest} 那个「乱码」是<b>两种不同的病</b>：
 * 那个是编码解释错位（UTF-8 字节被按 GBK 读），这个是目标编码<b>根本没有这个字符</b>。
 */
class ConsoleSafeTextTest {

    private static final Charset GBK = Charset.forName("GBK");

    @Test
    @DisplayName("GBK 需要降级,UTF-8 不需要 —— 判据是实测能否编码,不是猜名字")
    void needsFallbackOnlyWhenEncodingCannotHoldTheSymbols() {
        assertTrue(ConsoleSafeText.needsFallback(GBK));
        assertFalse(ConsoleSafeText.needsFallback(StandardCharsets.UTF_8));
        assertTrue(ConsoleSafeText.needsFallback(StandardCharsets.US_ASCII));
        assertFalse(ConsoleSafeText.needsFallback(null));
    }

    @Test
    @DisplayName("**UTF-8 下原样返回同一个引用** —— 常态必须零成本,不能每行都重建字符串")
    void utf8PassesThroughUntouched() {
        String s = "⚠️ 终端不支持 ANSI，inline 模式回退到 plain";
        assertSame(s, ConsoleSafeText.render(s, StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("GBK 下 ⚠️ 换成 [!],中文完整保留 —— 中文在 GBK 里是好的,别一起动")
    void gbkReplacesEmojiButKeepsChinese() {
        String out = ConsoleSafeText.render("⚠️ 终端不支持 ANSI，回退到 plain", GBK);
        assertEquals("[!] 终端不支持 ANSI，回退到 plain", out);
        assertTrue(GBK.newEncoder().canEncode(out), "降级后必须真的能被 GBK 编码");
    }

    @Test
    @DisplayName("常用符号各有 ASCII 等价物,且**保留视觉重量** —— 直接删掉会让警告看起来像普通信息")
    void commonSymbolsMapToAsciiWithWeight() {
        assertEquals("[ok] 完成", ConsoleSafeText.render("✅ 完成", GBK));
        assertEquals("[x] 失败", ConsoleSafeText.render("❌ 失败", GBK));
        assertEquals("[?] 查找", ConsoleSafeText.render("🔍 查找", GBK));
    }

    @Test
    @DisplayName("**GBK 本来就能表示的符号一个都不许动** —— 箭头/省略号/制表符在 GBK 里是有的")
    void symbolsThatGbkCanEncodeAreNotTouched() {
        // 第一版测试在这里断错了:以为 → 会被换成 ->。可 U+2192 在 GBK 里有,
        // canEncode 为真 → 整段原样返回。降级只该在**真的编码不了**时发生,
        // 否则 GBK 终端上会白白丢掉本来显示得很好的排版字符。
        for (String s : java.util.List.of("a → b", "前 … 后", "a — b", "x · y", "│ ─ └ ├")) {
            assertTrue(GBK.newEncoder().canEncode(s), "前提:GBK 能编码 " + s);
            assertSame(s, ConsoleSafeText.render(s, GBK), "不该被改写: " + s);
        }
    }

    @Test
    @DisplayName("表里没有的字符退成 ? 而**不是整段丢掉** —— 丢一行提示比显示 ? 糟得多")
    void unmappedUnencodableCharsBecomeQuestionMark() {
        String out = ConsoleSafeText.render("状态 🫠 未知", GBK);
        assertTrue(GBK.newEncoder().canEncode(out), out);
        assertTrue(out.contains("状态") && out.contains("未知"), "周围文字必须留住: " + out);
        assertTrue(out.contains("?"), "不可编码字符该留个占位: " + out);
    }

    @Test
    @DisplayName("代理对(4 字节 emoji)要整体处理,不能拆成两个 ? —— 那会多出一个字符")
    void surrogatePairCountsAsOneCharacter() {
        // 🫠 是 U+1FAE0,在 Java 里是一对 surrogate。按 char 逐个替换会得到两个 ?
        String out = ConsoleSafeText.render("🫠", GBK);
        assertEquals("?", out);
    }

    @Test
    @DisplayName("US-ASCII 下中文也编码不了,同样退 ? 而不抛")
    void asciiFallsBackWithoutThrowing() {
        String out = ConsoleSafeText.render("⚠️ 中文", StandardCharsets.US_ASCII);
        assertTrue(StandardCharsets.US_ASCII.newEncoder().canEncode(out), out);
        assertTrue(out.startsWith("[!]"), out);
    }

    @Test
    void nullAndEmptyAreSafe() {
        assertEquals(null, ConsoleSafeText.render(null, GBK));
        assertEquals("", ConsoleSafeText.render("", GBK));
        assertEquals("x", ConsoleSafeText.render("x", null));
    }

    @Test
    @DisplayName("纯 ASCII 文本在 GBK 下也原样返回同一引用 —— 绝大多数行都该走这条快路")
    void plainAsciiIsUntouchedEvenOnGbk() {
        String s = "Model claude-haiku-4-5 (freellmapi-2)";
        assertSame(s, ConsoleSafeText.render(s, GBK));
    }
}
