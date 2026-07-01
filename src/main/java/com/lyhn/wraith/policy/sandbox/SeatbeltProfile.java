package com.lyhn.wraith.policy.sandbox;

import java.util.List;

/**
 * 生成 macOS Seatbelt(sandbox-exec)的 SBPL profile 文本与 -D 参数。
 *
 * <p>workspace-write 语义:{@code (allow default)} 打底(宽松读)→ 收紧写与网络。
 * SBPL 后匹配规则优先,故 {@code .git} 的 deny 写在 workspace allow 之后以覆盖之。
 * 纯函数,无状态、无 IO、无平台依赖。
 */
public final class SeatbeltProfile {

    private SeatbeltProfile() {}

    /**
     * workspace-write profile:宽松读、写限定 workspace+$TMPDIR、.git 只读。
     *
     * @param networkAllowed true 则省略断网规则(全局放行);false 默认断网
     */
    public static String workspaceWrite(boolean networkAllowed) {
        StringBuilder sb = new StringBuilder(512);
        sb.append("(version 1)\n");
        // 宽松读 + 非文件/非网络操作放行;随后逐步收紧
        sb.append("(allow default)\n");
        // 写:先全禁,再放行 workspace / 临时目录
        sb.append("(deny file-write*)\n");
        sb.append("(allow file-write*\n");
        sb.append("    (subpath (param \"WORKSPACE\"))\n");
        sb.append("    (subpath (param \"TMPDIR\")))\n");
        // 常用设备/终端写(否则大量命令会崩)
        sb.append("(allow file-write*\n");
        sb.append("    (literal \"/dev/null\")\n");
        sb.append("    (literal \"/dev/zero\")\n");
        sb.append("    (literal \"/dev/stdout\")\n");
        sb.append("    (literal \"/dev/stderr\")\n");
        sb.append("    (literal \"/dev/tty\")\n");
        sb.append("    (subpath \"/dev/fd\"))\n");
        // .git 只读:覆盖上面的 workspace 放行(后匹配优先)
        sb.append("(deny file-write* (subpath (param \"GIT_DIR\")))\n");
        // 网络:默认全禁
        if (!networkAllowed) {
            sb.append("(deny network*)\n");
        }
        return sb.toString();
    }

    /** 构造 sandbox-exec 的 -D 参数(WORKSPACE / TMPDIR / GIT_DIR)。 */
    public static List<String> params(String workspaceRoot, String tmpDir, String gitDir) {
        return List.of(
                "-D", "WORKSPACE=" + workspaceRoot,
                "-D", "TMPDIR=" + tmpDir,
                "-D", "GIT_DIR=" + gitDir);
    }
}
