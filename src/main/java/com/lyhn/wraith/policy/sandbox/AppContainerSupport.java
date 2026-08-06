package com.lyhn.wraith.policy.sandbox;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Windows AppContainer 的可用性探测与发射器脚本落盘。
 *
 * <p>{@link #diagnose()} 是<b>唯一</b>判据来源：{@link #probe()} 与
 * {@code wraith sandbox doctor} 都从它出。刻意不让两边各算一遍——
 * 「面板说可用、doctor 说不可用」这类分叉，排查起来比原始故障还费劲。
 *
 * <p>脚本随 jar 走（{@code resources/sandbox/}），首次使用时释放到
 * {@code ~/.wraith/sandbox/}：PowerShell 需要一个真实文件路径，读不了 jar 内条目。
 */
public final class AppContainerSupport {

    private AppContainerSupport() {}

    static final String RESOURCE = "/sandbox/appcontainer-run.ps1";
    static final String SCRIPT_NAME = "appcontainer-run.ps1";

    /** AppContainer 需要 Windows 8+，但只在 10+ 验证过，低于 10 一律不启用。 */
    static final int MIN_WINDOWS_MAJOR = 10;

    /** 单项检查结果。{@code detail} 要能直接给用户看，不是给日志看。 */
    public record Check(String name, boolean ok, String detail) {}

    /** @param reason ready=false 时非空，是「为什么没有沙箱」的用户可读说明 */
    public record Diagnosis(boolean ready, List<Check> checks, String reason) {}

    interface CapabilityProbe {
        String resolvePowershell();

        String ensureLauncher() throws Exception;
    }

    private static final CapabilityProbe REAL_CAPABILITIES = new CapabilityProbe() {
        @Override
        public String resolvePowershell() {
            return AppContainerSupport.resolvePowershell();
        }

        @Override
        public String ensureLauncher() throws Exception {
            return AppContainerSupport.ensureLauncher();
        }
    };

    // 探测涉及 PATH 扫描 + 落盘,每条命令跑一次太浪费,故缓存。
    // 但 key 里带上 configDir —— 否则 -Dwraith.config.dir 换了目录,
    // 缓存还指着上一个,测试里会悄悄复用开发机的真实 ~/.wraith(WraithConfig 里
    // 那段「不做 static final 缓存」的注释踩的就是这个坑)。
    private static volatile String cachedKey;
    private static volatile Diagnosis cached;

    public static boolean probe() {
        return diagnose().ready();
    }

    /** 供 {@code wraith sandbox doctor} 逐项展示。 */
    public static Diagnosis diagnose() {
        String key = System.getProperty("os.name", "") + " " + configDir();
        Diagnosis d = cached;
        if (d != null && key.equals(cachedKey)) {
            return d;
        }
        d = compute(System.getProperty("os.name", ""), System.getProperty("os.version", ""));
        // **只缓存成功结果。** 失败也缓存的话,用户照提示修好环境(装回 PowerShell、
        // 把工作区挪到 NTFS 盘)之后不重启应用就永远显示「无沙箱」——
        // 一次性快照天生会漂,这个坑在「还没配置模型」引导条上刚踩过一次。
        // 重探的代价是一次 PATH 扫描,且只发生在本来就没有沙箱的路径上,不值得为它冒风险。
        if (d.ready()) {
            cachedKey = key;
            cached = d;
        }
        return d;
    }

    /** 测试用：丢弃缓存。 */
    static void resetCache() {
        cachedKey = null;
        cached = null;
    }

    static Diagnosis compute(String osName, String osVersion) {
        return compute(osName, osVersion, REAL_CAPABILITIES);
    }

    static Diagnosis compute(String osName, String osVersion, CapabilityProbe capabilities) {
        List<Check> checks = new ArrayList<>();

        boolean win = ShellCommand.isWindows(osName);
        checks.add(new Check("平台", win, win ? osName : osName + "（AppContainer 仅 Windows）"));
        if (!win) {
            return new Diagnosis(false, checks, "非 Windows 平台");
        }

        int major = majorVersion(osVersion);
        boolean verOk = major >= MIN_WINDOWS_MAJOR;
        checks.add(new Check("Windows 版本", verOk,
                verOk ? osVersion : osVersion + "（需 " + MIN_WINDOWS_MAJOR + " 及以上）"));

        String ps = capabilities.resolvePowershell();
        boolean psOk = ps != null;
        checks.add(new Check("powershell.exe", psOk,
                psOk ? ps : "在 PATH 中找不到（可能被组策略移除）"));

        String script = null;
        String scriptErr = null;
        try {
            script = capabilities.ensureLauncher();
        } catch (Exception e) {
            scriptErr = e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        boolean scriptOk = script != null;
        checks.add(new Check("发射器脚本", scriptOk, scriptOk ? script : "释放失败：" + scriptErr));

        boolean ready = verOk && psOk && scriptOk;
        String reason = ready ? null : checks.stream()
                .filter(c -> !c.ok())
                .map(c -> c.name() + " → " + c.detail())
                .findFirst().orElse(null);
        return new Diagnosis(ready, checks, reason);
    }

    /** {@code os.version} 形如 "10.0"（Windows 11 也报 10.0）；取不到主版本返回 -1。 */
    static int majorVersion(String osVersion) {
        if (osVersion == null || osVersion.isBlank()) return -1;
        String head = osVersion.trim().split("\\.")[0];
        try {
            return Integer.parseInt(head);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** 复用 MCP 那边修 npx 时写的 PATH × PATHEXT 解析——同一类问题，没必要写第二份。 */
    public static String powershellPath() {
        return resolvePowershell();
    }

    private static String resolvePowershell() {
        String p = com.lyhn.wraith.mcp.transport.StdioCommand.resolveExecutable("powershell.exe");
        return p != null ? p : com.lyhn.wraith.mcp.transport.StdioCommand.resolveExecutable("powershell");
    }

    /** 发射器脚本的落地路径；释放失败返回 null（调用方据此降级）。 */
    public static String launcherPath() {
        try {
            return ensureLauncher();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 把脚本从 jar 释放到 {@code ~/.wraith/sandbox/}，内容一致时不重写。
     *
     * <p>比对内容而不是只判存在：升级 wraith 之后脚本可能变了，
     * 「文件在就跳过」会让用户一直跑着旧版发射器，且完全无感。
     */
    static synchronized String ensureLauncher() throws Exception {
        Path dir = configDir().resolve("sandbox");
        Path target = dir.resolve(SCRIPT_NAME);
        String content = readResource();
        if (content == null) {
            throw new IllegalStateException("jar 内缺少 " + RESOURCE);
        }
        if (Files.isRegularFile(target)) {
            String existing = Files.readString(target, StandardCharsets.UTF_8);
            if (content.equals(existing)) {
                return target.toString();
            }
        }
        Files.createDirectories(dir);
        Files.writeString(target, content, StandardCharsets.UTF_8);
        return target.toString();
    }

    static String readResource() throws Exception {
        try (InputStream in = AppContainerSupport.class.getResourceAsStream(RESOURCE)) {
            if (in == null) return null;
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** 与 {@code WraithConfig.configDir()} 同口径：每次重新解析，不做 static final 缓存。 */
    private static Path configDir() {
        String override = System.getProperty("wraith.config.dir");
        if (override != null && !override.isBlank()) {
            return Path.of(override.trim());
        }
        return Path.of(System.getProperty("user.home"), ".wraith");
    }
}
