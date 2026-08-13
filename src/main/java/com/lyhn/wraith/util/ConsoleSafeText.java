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
        // ── 状态 ────────────────────────────────────────────────────────────
        ASCII.put("⚠", "[!]");
        ASCII.put("✅", "[ok]");
        ASCII.put("❌", "[x]");
        ASCII.put("✔", "[v]");
        ASCII.put("✓", "[v]");
        ASCII.put("✗", "[x]");
        ASCII.put("✘", "[x]");
        ASCII.put("🚫", "[no]");
        ASCII.put("🛑", "[off]");
        ASCII.put("⛔", "[no]");
        ASCII.put("🔴", "[!]");
        ASCII.put("🟡", "[~]");
        ASCII.put("🟢", "[ok]");
        ASCII.put("ℹ", "[i]");
        ASCII.put("💡", "[tip]");
        ASCII.put("❓", "[?]");
        // ── 文件与资料 ──────────────────────────────────────────────────────
        ASCII.put("📁", "[dir]");
        ASCII.put("📂", "[dir]");
        ASCII.put("📄", "[file]");
        ASCII.put("📝", "[note]");
        ASCII.put("📖", "[doc]");
        ASCII.put("📚", "[docs]");
        ASCII.put("📋", "[list]");
        ASCII.put("📭", "[empty]");
        ASCII.put("📰", "[news]");
        ASCII.put("📦", "[pkg]");
        ASCII.put("📊", "[stat]");
        ASCII.put("📏", "[len]");
        ASCII.put("📸", "[snap]");
        ASCII.put("🗑", "[del]");
        ASCII.put("🗄", "[archive]");
        ASCII.put("🔗", "[link]");
        ASCII.put("📤", "[send]");
        // ── 能力与子系统 ────────────────────────────────────────────────────
        ASCII.put("🔍", "[?]");
        ASCII.put("🔎", "[?]");
        ASCII.put("🧩", "[skill]");
        ASCII.put("🧠", "[mem]");
        ASCII.put("🌐", "[web]");
        ASCII.put("🕸", "[web]");
        ASCII.put("🌿", "[git]");
        ASCII.put("🐙", "[gh]");
        ASCII.put("🤖", "[ai]");
        ASCII.put("🔌", "[plug]");
        ASCII.put("🔧", "[tool]");
        ASCII.put("🛠", "[tool]");
        ASCII.put("🏗", "[build]");
        ASCII.put("🛡", "[safe]");
        ASCII.put("🕵", "[scan]");
        ASCII.put("🧹", "[clean]");
        ASCII.put("💾", "[save]");
        ASCII.put("💼", "[work]");
        ASCII.put("🖥", "[pc]");
        ASCII.put("⚙", "[cfg]");
        ASCII.put("🔒", "[lock]");
        ASCII.put("🔓", "[unlock]");
        ASCII.put("✏", "[edit]");
        ASCII.put("✂", "[cut]");
        ASCII.put("🎭", "[play]");
        ASCII.put("🚀", "[go]");
        ASCII.put("⚡", "[fast]");
        // ── 人 ──────────────────────────────────────────────────────────────
        ASCII.put("👋", "[hi]");
        ASCII.put("👤", "[user]");
        ASCII.put("🧑", "[user]");
        ASCII.put("👥", "[team]");
        ASCII.put("👆", "^");
        // ── 时间与进度 ──────────────────────────────────────────────────────
        ASCII.put("⏰", "[time]");
        ASCII.put("⏱", "[time]");
        ASCII.put("⏳", "[...]");
        ASCII.put("🔄", "[sync]");
        ASCII.put("🔁", "[loop]");
        ASCII.put("⏹", "[stop]");
        ASCII.put("⏸", "[pause]");
        ASCII.put("▶", ">");
        ASCII.put("⏵", ">");
        ASCII.put("⏭", ">>");
        ASCII.put("⏎", "[enter]");
        // ── 箭头与线条 ──────────────────────────────────────────────────────
        ASCII.put("→", "->");
        ASCII.put("←", "<-");
        ASCII.put("↑", "^");
        ASCII.put("↓", "v");
        ASCII.put("↔", "<->");
        ASCII.put("↩", "<-");
        ASCII.put("↳", "->");
        ASCII.put("⇒", "=>");
        ASCII.put("⇐", "<=");
        ASCII.put("›", ">");
        ASCII.put("⏷", "v");
        ASCII.put("…", "...");
        ASCII.put("—", "--");
        ASCII.put("−", "-");
        ASCII.put("·", "-");
        ASCII.put("•", "*");
        ASCII.put("▪", "-");
        ASCII.put("★", "*");
        ASCII.put("✢", "*");
        ASCII.put("⟦", "[[");
        ASCII.put("⟧", "]]");
        ASCII.put("│", "|");
        ASCII.put("─", "-");
        ASCII.put("└", "\\");
        ASCII.put("├", "|");
        ASCII.put("┌", "/");
        // 进度条与底纹:保住「填了多少」的对比,退成 ? 就整条看不出进度了
        ASCII.put("▰", "#");
        ASCII.put("▱", "-");
        ASCII.put("▀", "#");
        ASCII.put("▒", ":");
        ASCII.put("░", ".");
        // spinner:盲文点阵逐帧映到 ASCII 的四帧循环 —— 全退成 ? 会让它看着**停住了**,
        // 而 spinner 唯一的作用就是证明「还在动」。
        ASCII.put("⠋", "|");
        ASCII.put("⠙", "/");
        ASCII.put("⠹", "-");
        ASCII.put("⠸", "\\");
        ASCII.put("⠼", "|");
        ASCII.put("⠴", "/");
        ASCII.put("⠦", "-");
        ASCII.put("⠧", "\\");
        ASCII.put("⠇", "|");
        ASCII.put("⠏", "/");
    }

    /**
     * 这些码点<b>该丢掉，而不是变成 {@code ?}</b>。
     *
     * <p>它们本身不是字形，只是修饰前一个字符：变体选择符（{@code U+FE00–FE0F}，
     * 决定用彩色 emoji 还是黑白字形）、零宽连接符（{@code U+200D}，把两个 emoji 粘成一个）、
     * 肤色修饰符（{@code U+1F3FB–1F3FF}）。
     *
     * <p>用户 Windows 实测的 {@code ??} 就有它的份：{@code ⚠️} 是<b>两个</b>码点，
     * 各退一个 {@code ?}。表里逐个写 {@code "⚠️"}/{@code "⚠"} 两条能挡住已知的，
     * 但任何一个<b>没进表</b>的 emoji 带上它就又会多吐一个 {@code ?} ——
     * 所以这里按规则统一丢掉，而不是靠穷举。
     */
    private static boolean isModifierOnly(int cp) {
        return cp == 0x200D
                || (cp >= 0xFE00 && cp <= 0xFE0F)
                || (cp >= 0x1F3FB && cp <= 0x1F3FF);
    }

    private static String stripModifiers(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            int n = Character.charCount(cp);
            if (!isModifierOnly(cp)) {
                sb.append(s, i, i + n);
            }
            i += n;
        }
        return sb.toString();
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
        // 先丢掉纯修饰码点:否则 `⚠️` 这类「基字符 + 变体选择符」会多吐一个 `?`,
        // 而表里不可能穷举所有 emoji 的带修饰形态。
        String s = stripModifiers(text);
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
