package com.lyhn.wraith.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

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

    @Test
    @DisplayName("变体选择符该被**丢掉**而不是变成 ? —— `⚠️` 是两个码点,各退一个 ? 就成了 `??`")
    void modifierCodePointsAreDroppedNotQuestionMarked() {
        // U+FE0F(变体选择符)、U+200D(零宽连接符)、肤色修饰符:都不是字形,只修饰前一个字符
        assertEquals("[edit]", ConsoleSafeText.render("✏️", GBK));
        assertEquals("[hi]", ConsoleSafeText.render("👋🏻", GBK), "肤色修饰符也该丢掉");
        // 👨 和 💻 都不在表里(源码里没用到),各退一个 ? 是预期的;
        // 要钉的是**中间那个零宽连接符不再多占一个** —— 两个而不是三个。
        String zwj = ConsoleSafeText.render("👨‍💻", GBK);
        assertEquals(2, zwj.chars().filter(c -> c == '?').count(),
                "零宽连接符不该自己占一个 ?: " + zwj);
    }

    @Test
    @DisplayName("用户实测那句 `👋 你好！` 不能退成 `? 你好！`")
    void theExactGreetingFromTheWindowsSession() {
        assertEquals("[hi] 你好！", ConsoleSafeText.render("👋 你好！", GBK));
    }

    /**
     * <b>自维护的兜底</b>：把 {@code src/main/java} 里所有字符串字面量扫一遍，
     * 凡是 GBK 编不了的字符，都必须有 ASCII 等价物。
     *
     * <p>为什么要这条：符号表是手写的，实测里 {@code 👋 再见!} 就因为漏了一个字符退成
     * {@code ? 再见!}。首次扫出来 <b>100 种</b>会进控制台的字符，而表里只有 20 来个。
     * 靠人记「新加 emoji 记得补表」是记不住的，所以让测试记。
     *
     * <p>断言的是<b>行为</b>（{@code render} 的结果里不含 {@code ?}）而不是表的内容 ——
     * 将来若改成别的实现方式（比如按 Unicode 类别归并），这条测试仍然有效。
     */
    @Test
    @DisplayName("**源码里会输出的字符都得有 ASCII 等价物** —— 漏一个就是一个 `?`")
    void everyOutputCharacterInSourcesHasAnAsciiFallback() throws Exception {
        Path mainJava = Path.of("src/main/java");
        assumeTrue(Files.isDirectory(mainJava), "不在仓库根目录跑,跳过");

        Map<String, String> offenders = new LinkedHashMap<>();
        try (Stream<Path> walk = Files.walk(mainJava)) {
            for (Path file : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                    String trimmed = line.stripLeading();
                    // 注释进不了控制台;javadoc 里大量 emoji 是在讲这件事本身
                    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
                        continue;
                    }
                    for (String literal : stringLiterals(line)) {
                        collectUnmapped(literal, file.getFileName().toString(), offenders);
                    }
                }
            }
        }
        assertTrue(offenders.isEmpty(),
                "这些字符在 GBK 控制台上会退成 ?,请在 ConsoleSafeText.ASCII 里补映射:\n"
                        + offenders.entrySet().stream()
                        .map(e -> "  " + e.getKey() + "  (" + e.getValue() + ")")
                        .collect(java.util.stream.Collectors.joining("\n")));
    }

    private static List<String> stringLiterals(String line) {
        List<String> out = new java.util.ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"((?:[^\"\\\\\\n]|\\\\.)*)\"").matcher(line);
        while (m.find()) {
            out.add(m.group(1));
        }
        return out;
    }

    private static void collectUnmapped(String literal, String where, Map<String, String> offenders) {
        int i = 0;
        while (i < literal.length()) {
            int cp = literal.codePointAt(i);
            int n = Character.charCount(cp);
            String ch = literal.substring(i, i + n);
            i += n;
            if (cp < 0x2000 || GBK.newEncoder().canEncode(ch)) {
                continue;
            }
            // 判据是「整个结果就是一个 ?」= 走了兜底替换。
            // 不能写 contains("?"):`🔍 → [?]` 是**合法**的 ASCII 等价物,那样会自己咬自己。
            if ("?".equals(ConsoleSafeText.render(ch, GBK))) {
                offenders.putIfAbsent(String.format("U+%04X %s", cp, ch), where);
            }
        }
    }
}
