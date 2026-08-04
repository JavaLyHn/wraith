package com.lyhn.wraith.render;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 终端创建的降级诊断。
 *
 * <p>用户在 Windows 上拿到的全部信息只有一句「终端不支持 ANSI，inline 模式回退到 plain」，
 * 而那句话是<b>错的</b>（下一行就是带颜色的 WRAITH 大字），真正的后果是<b>行编辑失灵</b>
 * ——「输入命令也不管用」。
 *
 * <p>信息为什么会消失是我们自己造成的：{@code dumb(true)} 让 JLine 的
 * {@code if (!forceDumb && dumb == null)} 那个打日志的分支永远进不去。
 */
class TerminalBootstrapTest {

    private String savedProviders;

    @BeforeEach
    void save() {
        savedProviders = System.getProperty(TerminalBootstrap.PROP_PROVIDERS);
        System.clearProperty(TerminalBootstrap.PROP_PROVIDERS);
    }

    @AfterEach
    void restore() {
        if (savedProviders == null) {
            System.clearProperty(TerminalBootstrap.PROP_PROVIDERS);
        } else {
            System.setProperty(TerminalBootstrap.PROP_PROVIDERS, savedProviders);
        }
    }

    private static TerminalBootstrap.Diagnosis dumb(boolean ansi, List<String> log) {
        return new TerminalBootstrap.Diagnosis("dumb", "DumbTerminal", true, ansi, 80, 24, "jni,exec", log);
    }

    // ── provider 顺序收窄 ──────────────────────────────────────────────────

    @Test
    @DisplayName("**判据是「ffm 的类在不在」而不是 JDK 版本** —— jline:4.0.0:jdk11 里 impl/ffm 一个 class 都没有")
    void narrowsProvidersWhenFfmClassIsAbsent() {
        String result = TerminalBootstrap.narrowProviders();
        boolean ffmUsable = TerminalBootstrap.ffmClassPresent()
                && TerminalBootstrap.jdkFeatureVersion() >= 22;
        if (ffmUsable) {
            assertTrue(result.startsWith("ffm"), result);
        } else {
            assertEquals("jni,exec", result);
            assertEquals("jni,exec", System.getProperty(TerminalBootstrap.PROP_PROVIDERS));
        }
    }

    @Test
    @DisplayName("本仓库的依赖(jdk11 classifier)里 ffm 的实现类确实缺失 —— 这条钉住上面那个判据的前提")
    void ffmClassIsActuallyAbsentInThisBuild() {
        // 实测:org/jline/terminal/impl/ffm/ 目录在,但 0 个 class(jni 15 个、exec 6 个)。
        // 如果哪天换成带 FFM 的 classifier,这条会红 —— 那时上面的分支就该走 ffm 了,
        // 是提醒而不是故障。
        assertFalse(TerminalBootstrap.ffmClassPresent(),
                "ffm 类突然出现了:依赖或 classifier 变了,复查 narrowProviders 的判据");
    }

    @Test
    @DisplayName("**用户显式设了就一个字都不改** —— 那是排障时的逃生阀,被静默改掉最气人")
    void respectsExplicitProviderSetting() {
        System.setProperty(TerminalBootstrap.PROP_PROVIDERS, "exec");
        assertEquals("exec", TerminalBootstrap.narrowProviders());
        assertEquals("exec", System.getProperty(TerminalBootstrap.PROP_PROVIDERS));
    }

    // ── advice 文案 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("没降级就一句话都不说 —— 不知道就不说,和 EmbeddingErrorHint 同一条纪律")
    void silentWhenNotDowngraded() {
        TerminalBootstrap.Diagnosis ok = new TerminalBootstrap.Diagnosis(
                "xterm-256color", "NativeWinSysTerminal", false, true, 120, 40, "jni,exec", List.of());
        assertEquals("", TerminalBootstrap.advice(ok, "Windows 11"));
        assertEquals("", TerminalBootstrap.advice(null, "Windows 11"));
    }

    @Test
    @DisplayName("**降级时必须说「行编辑失灵」而不是「不支持 ANSI」** —— 后者在用户那台机器上是错的")
    void adviceNamesTheRealConsequenceNotAnsi() {
        String a = TerminalBootstrap.advice(dumb(true, List.of()), "Windows 11");
        assertTrue(a.contains("行编辑"), a);
        assertTrue(a.contains("补全") || a.contains("方向键"), a);
        // 认了 ANSI 的情况下,必须明确否掉那句错话,否则用户会去换终端
        assertTrue(a.contains("不是「终端不支持 ANSI」"), a);
    }

    @Test
    @DisplayName("Windows 上要说清「为什么只剩 jni」 —— 否则用户不知道该查什么")
    void adviceExplainsWhyOnlyJniRemainsOnWindows() {
        String a = TerminalBootstrap.advice(dumb(true, List.of()), "Windows 11");
        assertTrue(a.contains("jni"), a);
        assertTrue(a.contains("ffm"), a);
        // 措辞按实测改过两处:
        //  · 原来说「ffm 要 JDK 22+」——真实原因是 jdk11 classifier 里 impl/ffm 一个 class 都没有,
        //    与运行时 JDK 无关(用户 JDK 21 与我 JDK 26 都失败在同一处)
        //  · 原来说「exec 要 stty」——用户 doctor 报告里 exec 的真实失败是
        //    `Cannot run program "test"`,它探测 TTY 用的是 `test -t`
        assertTrue(a.contains("test -t"), a);
        assertFalse(a.contains("stty"), "别再说 stty,实测不是它: " + a);
    }

    @Test
    @DisplayName("**认出 native access 被挡并给出确切修法** —— 这是用户那台机器上 jni 失败的真原因")
    void adviceGivesTheNativeAccessFix() {
        String a = TerminalBootstrap.advice(dumb(true, List.of(
                "FINE: Unable to load jni provider:   <- UnsupportedOperationException: "
                        + "Native access is not enabled for the current module: unnamed module @2d8e6db6")),
                "Windows 11");
        assertTrue(a.contains("--enable-native-access=ALL-UNNAMED"), a);
        assertTrue(a.contains("wraith-install"), "要告诉用户重装短命令就能修: " + a);
        assertTrue(a.contains("24"), "要说清 manifest 那条为什么没生效(JDK 24+ 才识别): " + a);
        assertTrue(a.contains("可以修的"), a);
    }

    @Test
    @DisplayName("没有 native access 那条日志时不要凭空给这个修法 —— 不知道就不说")
    void adviceStaysSilentAboutNativeAccessWhenNotTheCause() {
        String a = TerminalBootstrap.advice(dumb(true, List.of(
                "FINE: Error creating jni based terminal:   <- UnsatisfiedLinkError: no jlinenative")),
                "Windows 11");
        assertFalse(a.contains("--enable-native-access"), a);
    }

    @Test
    @DisplayName("blockedByNativeAccess 只认那句确切原文")
    void blockedByNativeAccessMatchesExactMarker() {
        assertTrue(TerminalBootstrap.blockedByNativeAccess(List.of(
                "x Native access is not enabled for the current module: unnamed module")));
        assertFalse(TerminalBootstrap.blockedByNativeAccess(List.of("Error creating jni based terminal")));
        assertFalse(TerminalBootstrap.blockedByNativeAccess(null));
        assertFalse(TerminalBootstrap.blockedByNativeAccess(java.util.Arrays.asList((String) null)));
    }

    @Test
    @DisplayName("nativeAccessEnabled() 不抛,且三种取值都合法(null = 该 JDK 没这个概念)")
    void nativeAccessEnabledNeverThrows() {
        Boolean v = TerminalBootstrap.nativeAccessEnabled();
        assertTrue(v == null || v || !v);
        // 实测(mac JDK 26 Homebrew):裸 classpath 是 false,加 --enable-native-access 变 true,
        // java -jar 走 manifest 的 Enable-Native-Access 也是 true —— 那就是 mac 上 jni 能用的原因。
    }

    @Test
    @DisplayName("非 Windows 不讲 Windows 那套 —— 说错平台的话比不说更糟")
    void adviceSkipsWindowsSpecificsElsewhere() {
        String a = TerminalBootstrap.advice(dumb(true, List.of()), "Mac OS X");
        assertFalse(a.contains("stty"), a);
        assertTrue(a.contains("行编辑"), a);
    }

    @Test
    @DisplayName("**JLine 记下的失败原因要原样带出来** —— 这是唯一能定位 jni 为什么挂的东西")
    void adviceSurfacesJlineFailureReasons() {
        String a = TerminalBootstrap.advice(dumb(true, List.of(
                "FINE: Error creating jni based terminal:   <- UnsatisfiedLinkError: no jlinenative in java.library.path",
                "FINEST: something irrelevant")), "Windows 11");
        assertTrue(a.contains("Error creating jni based terminal"), a);
        assertTrue(a.contains("UnsatisfiedLinkError"), a);
        assertFalse(a.contains("something irrelevant"), "无关行不该混进来: " + a);
    }

    @Test
    @DisplayName("一条失败记录都没有时,要指出「可能不是 TTY」这个真实可能 —— 而不是留白")
    void adviceCoversTheNoLogCase() {
        String a = TerminalBootstrap.advice(dumb(false, List.of()), "Windows 11");
        assertTrue(a.contains("TTY") || a.contains("管道") || a.contains("重定向"), a);
    }

    @Test
    void adviceAlwaysPointsAtTheDoctor() {
        assertTrue(TerminalBootstrap.advice(dumb(true, List.of()), "Windows 11")
                .contains("wraith terminal doctor"));
    }

    // ── 日志筛选 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("只挑有诊断价值的行,并剥掉 java.util.logging 的级别前缀")
    void providerFailuresFiltersAndStripsLevel() {
        // Arrays.asList 而不是 List.of:后者不接受 null 元素,而「日志里混进 null 不该崩」
        // 正是这条用例要覆盖的一半
        List<String> picked = TerminalBootstrap.providerFailures(java.util.Arrays.asList(
                "FINE: Error creating exec based terminal:   <- IOException: stty not found",
                "WARNING: Unable to create a system terminal, creating a dumb terminal",
                "FINE: input is tty: false",
                "FINE: Using terminal DumbTerminal",
                null));
        assertEquals(3, picked.size(), picked.toString());
        assertTrue(picked.get(0).startsWith("Error creating exec"), picked.get(0));
        assertTrue(picked.stream().anyMatch(s -> s.contains("input is tty: false")), picked.toString());
        assertTrue(picked.stream().noneMatch(s -> s.startsWith("FINE:")), picked.toString());
    }


    @Test
    @DisplayName("**Unable to load 与 Available providers 也必须抓** —— 漏了它们会让报告自相矛盾")
    void providerFailuresCatchesLoadFailuresAndAvailabilityLine() {
        // 实测那次:上半部分日志里有 ClassNotFoundException,下半部分结论却说
        // 「JLine 没有留下失败记录」。就是因为这两类没进过滤器。
        List<String> picked = TerminalBootstrap.providerFailures(List.of(
                "FINE: Unable to load ffm provider:   <- ClassNotFoundException: org.jline.terminal.impl.ffm.FfmTerminalProvider",
                "FINE: Available providers: jni, exec",
                "FINE: Using terminal DumbTerminal"));
        assertEquals(2, picked.size(), picked.toString());
        assertTrue(picked.get(0).contains("Unable to load ffm"), picked.toString());
        assertTrue(picked.get(1).contains("Available providers: jni, exec"), picked.toString());
    }

    @Test
    void providerFailuresHandlesNullList() {
        assertTrue(TerminalBootstrap.providerFailures(null).isEmpty());
    }

    // ── 真实构建（mac 上跑，验证不抛且诊断字段被填上） ────────────────────

    @Test
    @DisplayName("真实 open() 不抛,并且把诊断交给回调 —— surefire 下 stdin 不是 TTY,正好覆盖降级路径")
    void realOpenNeverThrowsAndAlwaysDiagnoses() throws Exception {
        java.util.concurrent.atomic.AtomicReference<TerminalBootstrap.Diagnosis> seen =
                new java.util.concurrent.atomic.AtomicReference<>();
        try (org.jline.terminal.Terminal t = TerminalBootstrap.open(seen::set)) {
            assertTrue(t != null);
            TerminalBootstrap.Diagnosis d = seen.get();
            assertTrue(d != null, "诊断回调必须被调用");
            assertTrue(d.type() != null && !d.type().isBlank(), "type 该有值");
            assertTrue(d.implClass() != null && !d.implClass().isBlank(), "实现类名该有值");
            assertTrue(d.columns() > 0 && d.rows() > 0, "尺寸该有兜底值");
            assertTrue(d.providersRequested() != null && !d.providersRequested().isBlank());
        }
    }


    @Test
    @DisplayName("**真实 open() 的日志里不许再有 ffm 噪音** —— 光收窄 PROP_PROVIDERS 挡不住,"
            + "JLine 是无条件先 checkProvider(ffm) 的;Windows 上两条 Unable to load 会让人看混")
    void realOpenProducesNoFfmNoise() throws Exception {
        java.util.concurrent.atomic.AtomicReference<TerminalBootstrap.Diagnosis> seen =
                new java.util.concurrent.atomic.AtomicReference<>();
        try (org.jline.terminal.Terminal t = TerminalBootstrap.open(seen::set)) {
            assertTrue(t != null);
        }
        if (TerminalBootstrap.ffmUsable()) {
            return;   // ffm 真能用时不该关它,这条不适用
        }
        String log = String.join("\n", seen.get().jlineLog());
        assertFalse(log.toLowerCase(java.util.Locale.ROOT).contains("ffm"),
                "ffm 噪音还在:\n" + log);
    }

    @Test
    @DisplayName("**构建结束后 org.jline logger 必须恢复原状** —— 否则会把 JLine 的 debug 一直喷给用户")
    void restoresJlineLoggerAfterBuild() throws Exception {
        java.util.logging.Logger jline = java.util.logging.Logger.getLogger("org.jline");
        java.util.logging.Level before = jline.getLevel();
        boolean parentBefore = jline.getUseParentHandlers();
        int handlersBefore = jline.getHandlers().length;
        try (org.jline.terminal.Terminal t = TerminalBootstrap.open(d -> { })) {
            assertTrue(t != null);
        }
        assertEquals(before, jline.getLevel());
        assertEquals(parentBefore, jline.getUseParentHandlers());
        assertEquals(handlersBefore, jline.getHandlers().length, "收集用的 Handler 必须被摘掉");
    }
}
