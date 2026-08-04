package com.lyhn.wraith.render;

import com.lyhn.wraith.render.inline.TerminalCapabilities;
import org.jline.terminal.Terminal;
import org.jline.terminal.TerminalBuilder;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

/**
 * 创建 CLI 用的 JLine 终端，<b>并且把降级原因留下来</b>。
 *
 * <p><b>为什么需要这个类</b>（2026-08-04 Windows 实测）：用户看到的全部信息只有一句
 * {@code ?? 终端不支持 ANSI，inline 模式回退到 plain}，而且这句话是错的
 * （紧接着的输出就是带颜色的）。真实情况是 JLine 拿不到原生终端控制、降级成了
 * {@code DumbTerminal}，连带**行编辑也没了** —— 这才是「输入命令也不管用」的原因。
 *
 * <p><b>信息为什么会消失，是我们自己造成的</b>：原来代码写的是
 * {@code TerminalBuilder.builder().system(true).dumb(true)...}。翻 JLine 4.0 源码，
 * {@code doBuild()} 里打降级日志的条件是：
 * <pre>
 * if (terminal == null &amp;&amp; (forceDumb || dumb == null || dumb)) {
 *     if (!forceDumb &amp;&amp; dumb == null) {          // ← 只有 dumb 没被显式设置时才打
 *         Log.warn("Unable to create a system terminal, creating a dumb terminal ...");
 *     }
 * </pre>
 * 我们显式传了 {@code dumb(true)}，于是 {@code dumb == null} 为 false，
 * <b>一行日志都不打</b>。而每个 provider 的真实失败原因躺在
 * {@code Log.debug("Error creating " + prov.name() + " based terminal: ", ...)} 里，
 * 走的是 {@code java.util.logging} 的 {@code FINE} 级别，默认根本不输出。
 *
 * <p>做法：构建期间临时把 {@code org.jline} 这个 logger 的级别开到 {@code ALL}
 * 并挂一个内存 Handler，把记录收下来（同时 {@code setUseParentHandlers(false)}，
 * 避免 JLine 的 debug 喷到用户屏幕上），构建完立刻恢复原状。
 *
 * <p>另外顺手修掉一次注定失败的尝试：JLine 4.0 的 provider 默认顺序是
 * {@code ffm,jni,exec}，而本项目依赖的 {@code jline:4.0.0:jdk11} 里
 * <b>{@code impl/ffm} 一个 class 都没有</b>（实测；对照 {@code jni} 15 个、{@code exec} 6 个）。
 * 用户没有显式指定时把顺序收窄成 {@code jni,exec}，详见 {@link #narrowProviders()}。
 */
public final class TerminalBootstrap {

    private TerminalBootstrap() {
    }

    /** JLine 的 provider 顺序属性名（与 {@code TerminalBuilder.PROP_PROVIDERS} 一致）。 */
    static final String PROP_PROVIDERS = "org.jline.terminal.providers";

    /** 终端创建结果 + 诊断。 */
    public record Diagnosis(
            String type,
            String implClass,
            boolean dumb,
            boolean ansi,
            int columns,
            int rows,
            String providersRequested,
            List<String> jlineLog) {
    }

    /**
     * 打开系统终端。永不抛（失败也会给 dumb 终端），诊断信息在返回值里。
     *
     * <p>{@code graphemeCluster(false)}：禁掉 JLine 启动时的 mode 2027 探测。
     * 该探测会写 {@code ESC[?2027$p}，不支持此查询的终端（如 Apple Terminal）
     * 会把序列尾字符 {@code p} 直接打印出来 —— 表现为启动后左上角冒出一个 {@code p}。
     */
    public static Terminal open(java.util.function.Consumer<Diagnosis> onOpened) throws IOException {
        String requested = narrowProviders();
        List<String> log = Collections.synchronizedList(new ArrayList<>());
        Terminal terminal;
        Logger jline = Logger.getLogger("org.jline");
        Level savedLevel = jline.getLevel();
        boolean savedUseParent = jline.getUseParentHandlers();
        Handler collector = collector(log);
        jline.setLevel(Level.ALL);
        jline.setUseParentHandlers(false);   // 别把 JLine 的 debug 喷到用户屏幕上
        jline.addHandler(collector);
        try {
            terminal = TerminalBuilder.builder()
                    .system(true)
                    .dumb(true)
                    // 显式关掉 ffm,而不是只靠收窄 PROP_PROVIDERS:JLine 的 getProviders()
                    // 是**无条件**先 checkProvider(ffm,...) 再按 PROP_PROVIDERS 排序的,
                    // 所以光收窄顺序仍会留下一条 `Unable to load ffm provider` 噪音。
                    // Windows 上如果 jni 也失败,报告里就有两条 Unable to load,容易看混
                    // 到底哪条才是真问题。
                    .ffm(ffmUsable())
                    .graphemeCluster(false)
                    .build();
        } finally {
            jline.removeHandler(collector);
            jline.setLevel(savedLevel);
            jline.setUseParentHandlers(savedUseParent);
        }
        if (onOpened != null) {
            onOpened.accept(diagnose(terminal, requested, List.copyOf(log)));
        }
        return terminal;
    }

    static Diagnosis diagnose(Terminal terminal, String providersRequested, List<String> jlineLog) {
        String type = terminal == null ? null : terminal.getType();
        org.jline.terminal.Size size = terminal == null
                ? new org.jline.terminal.Size(0, 0)
                : TerminalCapabilities.safeSize(terminal);
        return new Diagnosis(
                type,
                terminal == null ? "(none)" : terminal.getClass().getSimpleName(),
                TerminalCapabilities.isDumbType(type),
                TerminalCapabilities.supportsAnsi(terminal),
                size.getColumns(),
                size.getRows(),
                providersRequested,
                jlineLog);
    }

    private static Handler collector(List<String> sink) {
        Handler h = new Handler() {
            @Override
            public void publish(LogRecord record) {
                if (record == null) {
                    return;
                }
                StringBuilder sb = new StringBuilder();
                sb.append(record.getLevel().getName()).append(": ").append(record.getMessage());
                Throwable t = record.getThrown();
                while (t != null) {
                    sb.append("  <- ").append(t.getClass().getSimpleName());
                    if (t.getMessage() != null && !t.getMessage().isBlank()) {
                        sb.append(": ").append(t.getMessage());
                    }
                    t = t.getCause();
                }
                sink.add(sb.toString());
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        };
        h.setLevel(Level.ALL);
        return h;
    }

    /**
     * 把 provider 顺序收窄到<b>本构件里真的存在</b>的那些，跳过注定失败的 {@code ffm}。
     *
     * <p><b>判据改过一次，起因是实测</b>：第一版按「JDK &lt; 22 才收窄」判，
     * 结果在 JDK 26 上跑 {@code wraith terminal doctor}，报告里赫然是
     * <pre>
     * FINE: Unable to load ffm provider: ... ClassNotFoundException:
     *       org.jline.terminal.impl.ffm.FfmTerminalProvider
     * </pre>
     * 查 jar 才发现：依赖用的是 {@code jline:4.0.0:jdk11} 这个 classifier，
     * 里头 {@code org/jline/terminal/impl/ffm/} <b>目录在但一个 class 都没有</b>
     * （对照：{@code jni} 15 个、{@code exec} 6 个）—— FFM 那部分为 JDK 11 目标被剔掉了。
     * 所以 <b>ffm 在这个依赖下永远不可用，跟运行时 JDK 版本无关</b>，
     * 按版本判会让 JDK 22+ 的机器每次启动都白试一次并抛异常。
     *
     * <p>现在两个条件都要满足才保留 ffm：类真的加载得到，且 JDK ≥ 22。
     *
     * <p><b>不覆盖用户显式设置</b>：已经设了 {@code org.jline.terminal.providers} 就原样尊重 ——
     * 那是排障时的逃生阀，被静默改掉最气人。
     *
     * @return 最终生效的 provider 顺序（供诊断展示）
     */
    static String narrowProviders() {
        String existing = System.getProperty(PROP_PROVIDERS);
        if (existing != null && !existing.isBlank()) {
            return existing;
        }
        if (ffmUsable()) {
            return "ffm,jni,exec (JLine 默认)";
        }
        System.setProperty(PROP_PROVIDERS, "jni,exec");
        return "jni,exec";
    }

    /** ffm provider 到底能不能用：类要在 classpath 上，JDK 也要够新。 */
    static boolean ffmUsable() {
        return ffmClassPresent() && jdkFeatureVersion() >= 22;
    }

    /** ffm provider 的实现类在不在 classpath 上（{@code jdk11} classifier 里没有）。 */
    static boolean ffmClassPresent() {
        try {
            Class.forName("org.jline.terminal.impl.ffm.FfmTerminalProvider", false,
                    TerminalBootstrap.class.getClassLoader());
            return true;
        } catch (Throwable notThere) {
            return false;
        }
    }

    /**
     * 本模块的 native access 是否启用；{@code null} = 该 JDK 没有这个概念。
     *
     * <p><b>这是 Windows 上 jni provider 失败的确切原因</b>（用户实测的 doctor 报告）：
     * <pre>
     * Unable to load jni provider: ... UnsupportedOperationException:
     *   Native access is not enabled for the current module: unnamed module
     * </pre>
     * JLine 的 {@code JniTerminalProvider} 构造器里有个前置检查，反射调
     * {@code Module.isNativeAccessEnabled()}（JDK 22+ 才有，<b>但 GraalVM 回移到了更早版本</b>），
     * 返回 false 就抛。用户那台是 JDK 21.0.10 却抛了 —— 说明它回移了这个方法。
     *
     * <p>而 jar 的 manifest 里虽然写了 {@code Enable-Native-Access: ALL-UNNAMED}，
     * 那是 <b>JDK 24+ 才识别</b>的属性，回移了检查却不认 manifest 的 JDK 就卡在中间。
     *
     * <p>实测（mac，JDK 26 Homebrew）：裸 classpath 跑是 {@code false}，
     * 加 {@code --enable-native-access=ALL-UNNAMED} 变 {@code true}；
     * 而 {@code java -jar} 走 manifest 时也是 {@code true} —— 这就是 mac 上 jni 能用的原因。
     */
    public static Boolean nativeAccessEnabled() {
        try {
            java.lang.reflect.Method m = Module.class.getMethod("isNativeAccessEnabled");
            return (Boolean) m.invoke(TerminalBootstrap.class.getModule());
        } catch (NoSuchMethodException noSuchConcept) {
            return null;       // JDK < 22 且未回移：不存在这个限制
        } catch (Throwable unexpected) {
            return null;
        }
    }

    /** 日志里出现的那句确切原因。 */
    static final String NATIVE_ACCESS_MARKER = "Native access is not enabled";

    static boolean blockedByNativeAccess(List<String> jlineLog) {
        if (jlineLog == null) {
            return false;
        }
        for (String line : jlineLog) {
            if (line != null && line.contains(NATIVE_ACCESS_MARKER)) {
                return true;
            }
        }
        return false;
    }

    static int jdkFeatureVersion() {
        try {
            return Runtime.version().feature();
        } catch (Exception unknown) {
            return 0;
        }
    }

    /**
     * 根据诊断给一段<b>可行动</b>的说明；没什么要说的返回空串。
     *
     * <p>纪律与 {@code EmbeddingErrorHint} 一致：只在能确定的形态上说话。
     * 尤其<b>不再说「终端不支持 ANSI」</b> —— 那句话在用户那台机器上是错的，
     * 而且把人引向「换终端」这个错方向。真正的后果是行编辑失灵。
     */
    public static String advice(Diagnosis d, String osName) {
        if (d == null || !d.dumb()) {
            return "";
        }
        boolean windows = osName != null && osName.toLowerCase(Locale.ROOT).startsWith("windows");
        StringBuilder sb = new StringBuilder();
        sb.append("⚠️ 拿不到原生终端控制，已降级为 dumb 终端（type=").append(d.type()).append("）。\n");
        if (d.ansi()) {
            sb.append("   颜色与面板照常工作 —— **这不是「终端不支持 ANSI」**。\n");
        }
        sb.append("   真正受影响的是**行编辑**：方向键 / Tab 补全 / 历史 / Ctrl-R 会失灵，"
                + "或者按下去只显示乱码字符。\n");
        if (windows) {
            // 「exec 要 stty」这句话改过:实测 exec 在 Windows 上失败的原因是
            // `Cannot run program "test"` —— 它探测 TTY 用的是 `test -t`,而 Windows 没有 test.exe。
            sb.append("   Windows 上 JLine 只有一条路可走：ffm 的实现类不在本构件里，")
                    .append("exec 要跑 `test -t` 探测 TTY（Windows 没有 test.exe），")
                    .append("所以只剩自带原生库的 jni —— 它失败了。\n");
        }
        if (blockedByNativeAccess(d.jlineLog())) {
            sb.append("   **这条是可以修的**：jni 被 JLine 的前置检查挡住了 —— 你的 JDK 回移了\n")
                    .append("   `Module.isNativeAccessEnabled()`（GraalVM 会），而它返回 false。\n")
                    .append("   修法：启动时加 `--enable-native-access=ALL-UNNAMED`\n")
                    .append("     · 用短命令的话重装一次即可（已自动探测并加上）：wraith-install\n")
                    .append("     · 手动：java --enable-native-access=ALL-UNNAMED -jar "
                            + "%USERPROFILE%\\.wraith\\wraith.jar\n")
                    .append("   （jar 的 manifest 里已有 Enable-Native-Access: ALL-UNNAMED，"
                            + "但那是 JDK 24+ 才识别的）\n");
        }
        List<String> failures = providerFailures(d.jlineLog());
        if (!failures.isEmpty()) {
            sb.append("   JLine 报告的原因：\n");
            for (String f : failures) {
                sb.append("     · ").append(f).append('\n');
            }
        } else {
            sb.append("   JLine 没有留下失败记录（可能是 stdin 不是 TTY —— "
                    + "例如被管道、重定向，或从非交互环境启动）。\n");
        }
        sb.append("   完整诊断：wraith terminal doctor");
        return sb.toString();
    }

    /**
     * 一行摘要，给启动屏用（完整诊断走 {@code wraith terminal doctor}）。
     *
     * <p>刻意<b>先说用户会感觉到的症状</b>（打字时方向键/Tab 不好使），再说术语。
     * 启动屏上只有一行的位置，那一行必须让人知道「等下按 Tab 没反应不是你的错」。
     */
    public static String shortNote(Diagnosis d) {
        if (d == null || !d.dumb()) {
            return "";
        }
        return "终端降级为 dumb：Tab 补全 / 方向键 / 历史不可用"
                + (d.ansi() ? "（颜色与面板正常）" : "")
                + "。诊断：wraith terminal doctor";
    }

    /**
     * 从 JLine 日志里挑出真正有诊断价值的行。
     *
     * <p><b>这份清单是实测补出来的</b>：第一版只认 {@code error creating} /
     * {@code unable to create} / {@code is tty:}，于是真跑 doctor 时报告<b>自相矛盾</b> ——
     * 上半部分「JLine 内部日志」里明明有
     * {@code Unable to load ffm provider: ... ClassNotFoundException}，
     * 下半部分「结论」却写着「JLine 没有留下失败记录」。
     * 漏掉的两类恰恰是最有用的：
     * <ul>
     *   <li>{@code Unable to load <name> provider} —— provider <b>类</b>都加载不了（比创建失败更早）</li>
     *   <li>{@code Available providers: jni, exec} —— 直接告诉你最后到底有哪几条路可走</li>
     * </ul>
     */
    static List<String> providerFailures(List<String> jlineLog) {
        List<String> out = new ArrayList<>();
        if (jlineLog == null) {
            return out;
        }
        for (String line : jlineLog) {
            if (line == null) {
                continue;
            }
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.contains("error creating") || lower.contains("unable to create")
                    || lower.contains("unable to load") || lower.contains("available providers")
                    || lower.contains("is tty:")) {
                out.add(line.replaceFirst("^(FINE|FINEST|WARNING|INFO|SEVERE|CONFIG): ", ""));
            }
        }
        return out;
    }
}
