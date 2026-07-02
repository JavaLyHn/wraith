package com.lyhn.wraith.policy.sandbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 把 agent 触发的 shell 命令包进 macOS Seatbelt(sandbox-exec)。
 *
 * <p>仅 {@code wraith app-server} 注入;交互式 CLI 不使用(ToolRegistry 的 sandbox 为 null)。
 * 非 macOS 或 {@code sandbox-exec} 不可用时 fail-open:裸跑并带回一条 warning。
 */
public final class CommandSandbox {

    private static final Path SANDBOX_EXEC = Path.of("/usr/bin/sandbox-exec");

    private final boolean networkAllowed;

    public CommandSandbox(boolean networkAllowed) {
        this.networkAllowed = networkAllowed;
    }

    public boolean networkAllowed() {
        return networkAllowed;
    }

    /** 命令构造结果。sandboxed=false 时 warning 非空(fail-open 原因)。 */
    public record Wrapped(List<String> command, boolean sandboxed, String warning) {}

    /** 当前平台是否支持 Seatbelt(macOS 且 sandbox-exec 可执行)。 */
    public static boolean available() {
        String os = System.getProperty("os.name", "").toLowerCase();
        return os.contains("mac") && Files.isExecutable(SANDBOX_EXEC);
    }

    /**
     * 包裹一条命令。workspaceRoot 为当前 project 根,调用时实时传入以避免陈旧根。
     */
    public Wrapped wrap(String workspaceRoot, String command) {
        String tmp = System.getenv("TMPDIR");
        if (tmp == null || tmp.isBlank()) {
            tmp = "/tmp";
        }
        String root = realPath(workspaceRoot);
        String tmpDir = realPath(tmp);
        String gitDir = root.endsWith("/") ? root + ".git" : root + "/.git";
        return buildCommand(available(), networkAllowed, root, tmpDir, gitDir, command);
    }

    /** 纯函数,便于两分支单测;不读环境、不探测平台。 */
    public static Wrapped buildCommand(boolean sandboxAvailable, boolean networkAllowed,
                                String root, String tmpDir, String gitDir, String command) {
        if (!sandboxAvailable) {
            return new Wrapped(
                    List.of("bash", "-c", command),
                    false,
                    "当前平台不支持 Seatbelt 沙箱,命令未沙箱化裸跑(仅 CommandGuard 黑名单生效)");
        }
        List<String> cmd = new ArrayList<>();
        cmd.add(SANDBOX_EXEC.toString());
        cmd.addAll(SeatbeltProfile.params(root, tmpDir, gitDir));
        cmd.add("-p");
        cmd.add(SeatbeltProfile.workspaceWrite(networkAllowed));
        cmd.add("bash");
        cmd.add("-c");
        cmd.add(command);
        return new Wrapped(List.copyOf(cmd), true, null);
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
