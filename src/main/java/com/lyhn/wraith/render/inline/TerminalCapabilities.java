package com.lyhn.wraith.render.inline;

import org.jline.terminal.Size;
import org.jline.terminal.Terminal;

import java.util.Locale;
import java.util.Map;

/**
 * 终端能力探测：决定 inline 渲染器的各项特性是否可启用。
 *
 * <p>探测逻辑保守——能开则开，老终端 / 非 TTY 环境优雅降级。
 *
 * <p><b>一个必须分清的区别</b>（2026-08-04 Windows 实测后重写）：
 * <ul>
 *   <li><b>「JLine 有没有拿到原生终端控制」</b> —— 决定 raw mode、准确尺寸、信号。
 *       拿不到时 JLine 给 {@code DumbTerminal}（type = {@code dumb} / {@code dumb-color}）。</li>
 *   <li><b>「终端本身会不会解释 ANSI 转义序列」</b> —— 决定颜色、光标移动、清行。</li>
 * </ul>
 * <b>这两件事无关。</b> 用户那台 Windows 上 JLine 降级成了 DumbTerminal，但
 * Windows Terminal 照样把 ANSI 渲染得好好的——旧代码把前者当成后者，于是打出
 * 「终端不支持 ANSI」，紧接着屏幕上就是带颜色的 WRAITH 大字，自相矛盾，
 * 还白白丢掉了 inline 渲染器的全部能力（思考面板、diff、工具块折叠）。
 *
 * <p>为什么 Windows 上容易降级：JLine 4.0 的 provider 默认顺序是
 * {@code ffm,jni,exec} —— {@code ffm} 要 JDK 22+（本项目 Java 17），
 * {@code exec} 在 Windows 上要 {@code stty}，于是只剩 {@code jni} 一条路，
 * 它一失败就没有退路。诊断走 {@code wraith terminal doctor}。
 */
public final class TerminalCapabilities {

    private TerminalCapabilities() {
    }

    /** JLine 的两种 dumb type（{@code Terminal.TYPE_DUMB} / {@code TYPE_DUMB_COLOR}）。 */
    public static boolean isDumbType(String type) {
        if (type == null) {
            return false;
        }
        String t = type.trim().toLowerCase(Locale.ROOT);
        return t.equals("dumb") || t.startsWith("dumb-color");
    }

    /** 终端是否能渲染 ANSI 转义序列（颜色、光标控制、inline status 等）。 */
    public static boolean supportsAnsi(Terminal terminal) {
        if (terminal == null) {
            return false;
        }
        return supportsAnsi(terminal.getType(), System.getProperty("os.name", ""), System.getenv());
    }

    /**
     * 可注入版本：便于在 mac 上验证 Windows 分支。
     *
     * <p>判据顺序有讲究：
     * <ol>
     *   <li>{@code TERM=dumb} 一律 false —— 那是终端<b>自己声明</b>的哑，比 type 更权威。
     *       <b>它必须排在 NO_COLOR 前面</b>：旧实现把 NO_COLOR 的检查放在前面并直接
     *       {@code return true}，于是 {@code NO_COLOR=1 TERM=dumb} 被判成支持 ANSI。
     *       NO_COLOR 的语义只是「别上颜色」，从来不是「我能解释光标控制序列」。</li>
     *   <li>type 不是 dumb → true。</li>
     *   <li>type 是 dumb → <b>再看有没有现代终端的环境证据</b>。有就 true
     *       （JLine 没拿到原生控制 ≠ 终端不解释 ANSI），没有才 false。</li>
     * </ol>
     */
    static boolean supportsAnsi(String type, String osName, Map<String, String> env) {
        if (type == null) {
            return false;
        }
        // 逃生阀,优先级最高:下面的「现代终端证据」清单一定会漏掉某些终端,
        // 漏掉时用户要有办法自己强开,而不是等我们改代码发版。
        if (Boolean.parseBoolean(trimmed(env.get("WRAITH_FORCE_ANSI")))
                || Boolean.parseBoolean(System.getProperty("wraith.force.ansi"))) {
            return true;
        }
        String term = env.get("TERM");
        if (term != null && term.trim().equalsIgnoreCase("dumb")) {
            return false;
        }
        if (!isDumbType(type)) {
            return true;
        }
        return hasModernTerminalEvidence(env);
    }

    /**
     * 有没有「这个终端会解释 ANSI」的实证。
     *
     * <p>只认<b>终端自己注入的</b>标记，不去猜 Windows 版本号 —— conhost 从
     * Windows 10 1607 起支持 VT，但要显式开启 {@code ENABLE_VIRTUAL_TERMINAL_PROCESSING}，
     * 而 DumbTerminal 那条路上没人去开它。所以宁可少认，别把控制序列打成乱码。
     */
    static boolean hasModernTerminalEvidence(Map<String, String> env) {
        if (notBlank(env.get("WT_SESSION"))) {
            return true;        // Windows Terminal
        }
        String conemu = env.get("ConEmuANSI");
        if (conemu != null && conemu.trim().equalsIgnoreCase("ON")) {
            return true;        // ConEmu（OFF 是明确说了关掉,不能当证据）
        }
        if (notBlank(env.get("ANSICON"))) {
            return true;        // ansicon 垫片
        }
        if (notBlank(env.get("TERM_PROGRAM"))) {
            return true;        // VS Code / iTerm / Apple Terminal / WezTerm …
        }
        if (notBlank(env.get("COLORTERM"))) {
            return true;
        }
        String emulator = env.get("TERMINAL_EMULATOR");
        if (emulator != null && emulator.toLowerCase(Locale.ROOT).contains("jetbrains")) {
            return true;        // IDEA 内置终端
        }
        String term = env.get("TERM");
        if (term != null) {
            String t = term.toLowerCase(Locale.ROOT);
            return t.contains("xterm") || t.contains("vt100") || t.contains("screen")
                    || t.contains("color") || t.contains("ansi");
        }
        return false;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String trimmed(String s) {
        return s == null ? null : s.trim();
    }

    /**
     * 终端是否适合启用 inline status 状态区。
     * 同时校验终端尺寸合理（rows ≥ 5）。
     */
    public static boolean supportsScrollRegion(Terminal terminal) {
        if (terminal == null) {
            return false;
        }
        return supportsScrollRegionFor(terminal, System.getProperty("os.name", ""), System.getenv());
    }

    /**
     * 可注入版本。
     *
     * <p><b>dumb 上一律不开，哪怕 ANSI 是认的</b>：{@code DumbTerminal.getSize()} 来自
     * env 的 {@code COLUMNS}/{@code LINES}，没有就是 {@code (80,24)} 兜底。
     * scroll region（DECSTBM）按错的行数设下去，状态栏会画到屏幕中间、或者把正文裁掉 ——
     * 那比「没有状态栏」糟得多。所以两个能力在这里被<b>分开</b>：
     * ANSI 开（颜色/面板/diff 都回来），scroll region 不开。
     */
    static boolean supportsScrollRegionFor(Terminal terminal, String osName, Map<String, String> env) {
        if (!supportsAnsi(terminal.getType(), osName, env)) {
            return false;
        }
        if (isDumbType(terminal.getType())) {
            return false;
        }
        if (Boolean.parseBoolean(env.get("WRAITH_NO_STATUSBAR"))) {
            return false;
        }
        if (Boolean.parseBoolean(System.getProperty("wraith.no.statusbar"))) {
            return false;
        }
        Size size = safeSize(terminal);
        return size.getRows() >= 5 && size.getColumns() >= 20;
    }

    /** 终端是否支持 24-bit TrueColor（用于丰富的代码高亮等）。 */
    public static boolean supportsTrueColor() {
        String colorterm = System.getenv("COLORTERM");
        return "truecolor".equalsIgnoreCase(colorterm) || "24bit".equalsIgnoreCase(colorterm);
    }

    public static Size safeSize(Terminal terminal) {
        try {
            Size s = terminal.getSize();
            if (s == null || s.getRows() <= 0 || s.getColumns() <= 0) {
                return new Size(80, 24);
            }
            return s;
        } catch (Exception e) {
            return new Size(80, 24);
        }
    }
}
