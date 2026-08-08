package com.lyhn.wraith.policy.sandbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 把 agent 触发的 shell 命令包进平台原生沙箱。
 *
 * <ul>
 *   <li><b>macOS</b> → Seatbelt（{@code sandbox-exec} + SBPL profile）</li>
 *   <li><b>Windows</b> → AppContainer（经 PowerShell 发射器，见 {@link AppContainerCommand}）</li>
 *   <li><b>其它</b> → 无沙箱，fail-open 裸跑并带回一条 warning</li>
 * </ul>
 *
 * <p>仅 {@code wraith app-server} / gateway / automation 注入；交互式 CLI 不使用
 * （ToolRegistry 的 sandbox 为 null）。
 *
 * <p><b>fail-open 而非 fail-closed</b>：沙箱起不来时裸跑 + 警告，不阻断用户。
 * 一个「因为没授权 npm 缓存目录就默默掐掉 {@code npm install}」的沙箱，
 * 排查成本远高于它带来的安全收益。但 warning 必须能到 UI（见 {@code degradedReason}），
 * 只写 {@code log.warn} 等于没说。
 */
public final class CommandSandbox {

    private static final String SANDBOX_EXEC = "/usr/bin/sandbox-exec";

    private final boolean networkAllowed;

    public CommandSandbox(boolean networkAllowed) {
        this.networkAllowed = networkAllowed;
    }

    public boolean networkAllowed() {
        return networkAllowed;
    }

    /**
     * 命令构造结果。
     *
     * @param kind    实际生效的沙箱；{@link SandboxKind#NONE} 时 {@code warning} 非空
     * @param warning fail-open 原因，要一路带到 UI，不能只进日志
     */
    public record Wrapped(List<String> command, SandboxKind kind, String warning) {
        public boolean sandboxed() {
            return kind.sandboxed();
        }
    }

    /**
     * 构造命令行所需的全部环境事实。
     *
     * <p>收成一个 record 而不是摊成参数列表：{@link #buildCommand} 本来就要
     * 平台、shell、发射器、解释器四样，摊开就是十个形参——调用点会变成一串
     * 分不清谁是谁的字符串。全部注入是为了能在 mac 上验 Windows 分支。
     */
    record Env(String osName, String comSpec, String launcherPath, String powershellPath) {
        static Env real() {
            return new Env(System.getProperty("os.name", ""), System.getenv("ComSpec"),
                    AppContainerSupport.launcherPath(), AppContainerSupport.powershellPath());
        }
    }

    /** 当前平台实际可用的沙箱种类。 */
    public static SandboxKind detect() {
        return detect(System.getProperty("os.name", ""),
                Files.isExecutable(Path.of(SANDBOX_EXEC)),
                AppContainerSupport.probe());
    }

    /** 纯函数版本：平台探测结果全部注入，便于在 mac 上验 Windows 分支。 */
    static SandboxKind detect(String osName, boolean seatbeltExecutable, boolean appContainerReady) {
        if (ShellCommand.isWindows(osName)) {
            return appContainerReady ? SandboxKind.APPCONTAINER : SandboxKind.NONE;
        }
        boolean mac = osName != null && osName.toLowerCase(java.util.Locale.ROOT).contains("mac");
        return mac && seatbeltExecutable ? SandboxKind.SEATBELT : SandboxKind.NONE;
    }

    /** 兼容旧调用点：是否有任何沙箱可用。新代码请用 {@link #detect()} 拿具体种类。 */
    public static boolean available() {
        return detect().sandboxed();
    }

    /**
     * 包裹一条命令。workspaceRoot 为当前 project 根，调用时实时传入以避免陈旧根。
     */
    public Wrapped wrap(String workspaceRoot, String command) {
        String tmp = System.getenv("TMPDIR");
        if (tmp == null || tmp.isBlank()) {
            tmp = "/tmp";
        }
        String root = realPath(workspaceRoot);
        String tmpDir = realPath(tmp);
        String gitDir = root.endsWith("/") ? root + ".git" : root + "/.git";
        return buildCommand(detect(), networkAllowed, root, tmpDir, gitDir, command, Env.real());
    }

    /** 纯函数，便于三分支单测；不读环境、不探测平台。 */
    static Wrapped buildCommand(SandboxKind kind, boolean networkAllowed,
                                String root, String tmpDir, String gitDir, String command, Env env) {
        // 无沙箱时该走哪个 shell,由平台决定 —— 此前这里和 ToolRegistry 各写死了一份
        // `bash -c`,是 Windows 上 execute_command 压根跑不起来的直接原因。
        List<String> plainShell = ShellCommand.wrap(env.osName(), env.comSpec(), command);

        switch (kind) {
            case SEATBELT -> {
                List<String> cmd = new ArrayList<>();
                cmd.add(SANDBOX_EXEC);
                cmd.addAll(SeatbeltProfile.params(root, tmpDir, gitDir));
                cmd.add("-p");
                cmd.add(SeatbeltProfile.workspaceWrite(networkAllowed));
                cmd.addAll(plainShell); // mac 上就是 bash -c <command>
                return new Wrapped(List.copyOf(cmd), SandboxKind.SEATBELT, null);
            }
            case APPCONTAINER -> {
                return new Wrapped(
                        AppContainerCommand.build(env.powershellPath(), env.launcherPath(),
                                networkAllowed, root, gitDir, command),
                        SandboxKind.APPCONTAINER, null);
            }
            default -> {
                return new Wrapped(plainShell, SandboxKind.NONE, noSandboxWarning(env.osName()));
            }
        }
    }

    /** fail-open 文案要说清「这个平台上还剩什么在保护你」，否则用户无从判断风险。 */
    public static String noSandboxWarning(String osName) {
        if (ShellCommand.isWindows(osName)) {
            return "AppContainer 沙箱不可用，命令未沙箱化裸跑（仍受命令黑名单与 HITL 审批保护）"
                    + "；执行 `wraith sandbox doctor` 可查看具体缺哪一项";
        }
        return "当前平台不支持 Seatbelt 沙箱，命令未沙箱化裸跑（仍受命令黑名单与 HITL 审批保护）";
    }

    private static String realPath(String p) {
        Path path = Path.of(p);
        try {
            if (Files.exists(path)) {
                return path.toRealPath().toString();
            }
        } catch (Exception ignored) {
            // 落到 normalize 分支
        }
        return path.toAbsolutePath().normalize().toString();
    }
}
