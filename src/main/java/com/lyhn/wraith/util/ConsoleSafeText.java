package com.lyhn.wraith.util;

import java.nio.charset.Charset;
import java.nio.charset.CharsetEncoder;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把输出文本降级到「当前控制台编码真能表示」的形态。
 *
 * <p><b>起因</b>（Windows 实测）：
 * <pre>
 * PS C:\Users\LyHn&gt; wraith
 * ?? 终端不支持 ANSI，inline 模式回退到 plain
 * </pre>
 * 中文<b>是好的</b>，只有开头的 {@code ⚠️} 变成了 {@code ??} —— 因为中文 Windows 控制台
 * 码页是 GBK/936，而 {@code ⚠}（U+26A0）和变体选择符 {@code U+FE0F} 都不在 GBK 里。
 * 两个码点各降级成一个 {@code ?}，就成了 {@code ??}。
 *
 * <p>这不是「乱码」（乱码是编码解释错位，见 {@code WindowsLauncherScriptTest}），
 * 而是<b>目标编码根本没有这个字符</b>。所以修法不是换编码，而是<b>换字符</b>：
 * 给常用符号准备 ASCII 等价物，其余不可编码字符退成 {@code ?}。
 *
 * <p><b>只在需要时才动手</b>：UTF-8 控制台（mac/Linux/已 chcp 65001 的 Windows）
 * 能编码全部 emoji，{@link #needsFallback(Charset)} 返回 false，文本原样通过。
 */
public final class ConsoleSafeText {

    private ConsoleSafeText() {
    }

    /** 探测用的代表性字符：仓库里实际在用的那些符号。 */
    private static final String PROBE = "⚠️✅❌🔍📁✂️🧩🧠";

    /**
     * 常用符号 → ASCII 等价物。
     *
     * <p>刻意保留「有东西在这里」的视觉重量（{@code [!]} 而不是空字符串）——
     * 直接删掉会让「警告」和「普通信息」看起来一样。
     */
    private static final Map<String, String> ASCII = new LinkedHashMap<>();

    static {
        ASCII.put("⚠️", "[!]");
        ASCII.put("⚠", "[!]");
        ASCII.put("✅", "[ok]");
        ASCII.put("❌", "[x]");
        ASCII.put("✔", "[v]");
        ASCII.put("✓", "[v]");
        ASCII.put("✗", "[x]");
        ASCII.put("🔍", "[?]");
        ASCII.put("📁", "[dir]");
        ASCII.put("📄", "[file]");
        ASCII.put("✂️", "[cut]");
        ASCII.put("✂", "[cut]");
        ASCII.put("🧩", "[skill]");
        ASCII.put("🧠", "[mem]");
        ASCII.put("🌐", "[web]");
        ASCII.put("🌿", "[git]");
        ASCII.put("⏰", "[time]");
        ASCII.put("🎭", "[play]");
        ASCII.put("🐙", "[gh]");
        ASCII.put("💾", "[save]");
        ASCII.put("🔁", "[loop]");
        ASCII.put("→", "->");
        ASCII.put("←", "<-");
        ASCII.put("↑", "^");
        ASCII.put("↓", "v");
        ASCII.put("…", "...");
        ASCII.put("—", "--");
        ASCII.put("·", "-");
        ASCII.put("•", "*");
        ASCII.put("★", "*");
        ASCII.put("│", "|");
        ASCII.put("─", "-");
        ASCII.put("└", "\\");
        ASCII.put("├", "|");
        ASCII.put("┌", "/");
    }

    /**
     * 这个编码需要降级吗。
     *
     * <p>判据是<b>实测能不能编码</b>，不是「名字是不是 UTF-8」——
     * 猜名字会漏掉 GB18030（它其实能表示很多 emoji）这类情况。
     */
    public static boolean needsFallback(Charset out) {
        if (out == null) {
            return false;
        }
        try {
            return !out.newEncoder().canEncode(PROBE);
        } catch (Exception unsupported) {
            return true;
        }
    }

    /**
     * 每线程每编码缓存一个 encoder。
     *
     * <p>流式输出会按 token 逐段调 {@link #render}，每次 {@code newEncoder()} 都是一次对象分配 ——
     * 在一轮长回答里那是成千上万次。{@code CharsetEncoder} 不是线程安全的，所以按线程存。
     */
    private static final ThreadLocal<java.util.Map<String, CharsetEncoder>> ENCODERS =
            ThreadLocal.withInitial(java.util.HashMap::new);

    private static CharsetEncoder encoderFor(Charset out) {
        return ENCODERS.get().computeIfAbsent(out.name(), n -> out.newEncoder());
    }

    /** 按目标编码把文本降级；{@code out} 能全部编码时原样返回（同一个引用）。 */
    public static String render(String text, Charset out) {
        if (text == null || text.isEmpty() || out == null) {
            return text;
        }
        CharsetEncoder encoder;
        try {
            encoder = encoderFor(out);
        } catch (Exception unsupported) {
            return text;
        }
        if (encoder.canEncode(text)) {
            return text;        // 常态:UTF-8 控制台,零成本
        }
        String s = text;
        for (Map.Entry<String, String> e : ASCII.entrySet()) {
            if (s.indexOf(e.getKey()) >= 0 && !encoder.canEncode(e.getKey())) {
                s = s.replace(e.getKey(), e.getValue());
            }
        }
        // 表里没有的、仍编码不了的:逐字符退成 '?'。**不能整段丢掉** ——
        // 丢掉一行提示比显示 `?` 糟得多。
        if (encoder.canEncode(s)) {
            return s;
        }
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            int n = Character.charCount(cp);
            String chunk = s.substring(i, i + n);
            sb.append(encoder.canEncode(chunk) ? chunk : "?");
            i += n;
        }
        return sb.toString();
    }
}
