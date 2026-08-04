package com.lyhn.wraith.render;

import com.lyhn.wraith.render.inline.TerminalCapabilities;
import com.lyhn.wraith.util.ConsoleSafeText;
import org.jline.terminal.Terminal;

import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * {@code wraith terminal doctor} —— 终端体检，对标 {@code wraith sandbox doctor}。
 *
 * <p><b>为什么要有它</b>：Windows 上 CLI 的两个症状（提示说「终端不支持 ANSI」、
 * 输入命令不管用）根子都在「JLine 拿到了什么样的终端」，而这件事此前<b>完全不可观测</b> ——
 * {@code dumb(true)} 让 JLine 一行日志都不打（见 {@link TerminalBootstrap} 的说明）。
 * 开发在 mac 上，Windows 上到底哪个 provider 失败、为什么失败，只能靠这份报告带回来。
 *
 * <p>报告刻意<b>不做判断句以外的猜测</b>：能测到的就报数值，测不到的就说「测不到」。
 */
public final class TerminalDoctor {

    private TerminalDoctor() {
    }

    /** {@code wraith terminal doctor} / {@code wraith terminal}。 */
    public static boolean isCommand(String[] args) {
        return args != null && args.length >= 1 && "terminal".equalsIgnoreCase(args[0]);
    }

    public static int run(String[] args) {
        if (args.length >= 2 && !"doctor".equalsIgnoreCase(args[1])) {
            System.err.println("用法: wraith terminal doctor");
            return 2;
        }
        Charset out = consoleEncoding();
        for (String line : report(out)) {
            System.out.println(ConsoleSafeText.render(line, out));
        }
        return 0;
    }

    /** 真实体检（会真的开一次终端）。返回逐行报告。 */
    static List<String> report(Charset consoleEncoding) {
        List<String> lines = new ArrayList<>();
        String os = System.getProperty("os.name", "?");
        lines.add("wraith terminal doctor");
        lines.add("");
        lines.add("── 运行环境 ─────────────────────────────────────────");
        lines.add("  os.name          " + os);
        lines.add("  os.arch          " + System.getProperty("os.arch", "?"));
        lines.add("  java.version     " + System.getProperty("java.version", "?")
                + "   (JLine 的 ffm provider 需要 22+)");
        lines.add("  控制台编码       " + consoleEncoding
                + (ConsoleSafeText.needsFallback(consoleEncoding)
                ? "   ← 表示不了 emoji，输出会自动降级为 ASCII" : ""));
        lines.add("");
        lines.add("── 相关环境变量 ─────────────────────────────────────");
        for (String key : List.of("TERM", "TERM_PROGRAM", "COLORTERM", "WT_SESSION",
                "ConEmuANSI", "ANSICON", "TERMINAL_EMULATOR", "NO_COLOR",
                "WRAITH_RENDERER", "WRAITH_FORCE_ANSI", "WRAITH_NO_STATUSBAR")) {
            String v = System.getenv(key);
            lines.add(String.format("  %-18s %s", key, v == null ? "(未设)" : v));
        }
        String providers = System.getProperty(TerminalBootstrap.PROP_PROVIDERS);
        lines.add(String.format("  %-18s %s", TerminalBootstrap.PROP_PROVIDERS,
                providers == null ? "(未设，将按 JDK 版本自动收窄)" : providers));
        lines.add("");

        TerminalBootstrap.Diagnosis[] box = new TerminalBootstrap.Diagnosis[1];
        Throwable failure = null;
        try (Terminal t = TerminalBootstrap.open(d -> box[0] = d)) {
            lines.add("── JLine 拿到的终端 ─────────────────────────────────");
            lines.add("  实现类           " + t.getClass().getName());
            lines.add("  type             " + t.getType());
            lines.add("  尺寸             " + TerminalCapabilities.safeSize(t).getColumns()
                    + " 列 × " + TerminalCapabilities.safeSize(t).getRows() + " 行");
        } catch (Throwable e) {
            failure = e;
            lines.add("── JLine 拿到的终端 ─────────────────────────────────");
            lines.add("  ❌ 连 dumb 终端都建不起来: " + e);
        }

        TerminalBootstrap.Diagnosis d = box[0];
        if (d != null) {
            lines.add("  provider 顺序    " + d.providersRequested());
            lines.add("");
            lines.add("── 能力判定 ─────────────────────────────────────────");
            lines.add("  原生终端控制     " + yn(!d.dumb())
                    + (d.dumb() ? "   ← 行编辑/补全/历史/方向键会失灵" : ""));
            lines.add("  ANSI 转义序列    " + yn(d.ansi())
                    + (d.dumb() && d.ansi() ? "   ← dumb 但终端会解释 ANSI，颜色与面板照常" : ""));
            lines.add("  inline 渲染器    " + yn(d.ansi()) + "   (false 时回退 PlainRenderer)");
            lines.add("  常驻状态栏       " + yn(!d.dumb() && d.ansi())
                    + (d.dumb() ? "   ← dumb 的尺寸不可信，scroll region 会画错位置，故关闭" : ""));
            if (!d.jlineLog().isEmpty()) {
                lines.add("");
                lines.add("── JLine 内部日志（provider 为什么失败就在这里）──────");
                for (String line : d.jlineLog()) {
                    lines.add("  " + line);
                }
            }
            String advice = TerminalBootstrap.advice(d, os);
            if (!advice.isBlank()) {
                lines.add("");
                lines.add("── 结论 ─────────────────────────────────────────────");
                for (String line : advice.split("\n")) {
                    lines.add("  " + line);
                }
            } else if (failure == null) {
                lines.add("");
                lines.add("✅ 终端能力完整，没有降级。");
            }
        }
        lines.add("");
        lines.add("── 逃生阀 ───────────────────────────────────────────");
        lines.add("  WRAITH_FORCE_ANSI=true          强制认定终端支持 ANSI（值必须是 true，"
                + "写 1 不生效）");
        lines.add("  WRAITH_RENDERER=plain           关掉 inline 渲染（最朴素，最不容易出问题）");
        lines.add("  WRAITH_NO_STATUSBAR=true        只关常驻状态栏");
        lines.add("  -Dorg.jline.terminal.providers=  手动指定 provider 顺序，如 jni 或 exec");
        return lines;
    }

    private static String yn(boolean b) {
        return b ? "✅ 有" : "❌ 无";
    }

    /**
     * 控制台输出编码。
     *
     * <p>JDK 19+ 有 {@code stdout.encoding}；更早的 JDK 上退回 {@code native.encoding}
     * 再退 {@code file.encoding}。这是判断「emoji 会不会变成 ?」的依据。
     */
    public static Charset consoleEncoding() {
        for (String prop : List.of("stdout.encoding", "native.encoding", "file.encoding")) {
            String v = System.getProperty(prop);
            if (v != null && !v.isBlank()) {
                try {
                    return Charset.forName(v.trim());
                } catch (Exception unsupported) {
                    // 试下一个
                }
            }
        }
        return Charset.defaultCharset();
    }

    static boolean isWindows(String osName) {
        return osName != null && osName.toLowerCase(Locale.ROOT).startsWith("windows");
    }
}
