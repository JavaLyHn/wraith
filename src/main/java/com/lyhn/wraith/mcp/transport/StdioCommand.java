package com.lyhn.wraith.mcp.transport;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;

/**
 * 把 MCP stdio server 的「命令 + 参数」拼成真正可以交给 {@link ProcessBuilder} 的命令行。
 *
 * <p><b>为什么需要这一层：</b>Windows 的 {@code CreateProcess} 与 POSIX 的 {@code execvp} 有两点关键差异——
 * 它<b>不做 {@code PATHEXT} 补全</b>，也不认没有扩展名的命令。而 npm 生态在 Windows 上
 * 装出来的是 {@code npx.cmd} / {@code pnpm.cmd}（批处理），不是 {@code npx}。
 * 于是最常见的 MCP 配置（{@code command: "npx"}）在 Windows 上必然失败：
 *
 * <pre>Cannot run program "npx": CreateProcess error=2, 系统找不到指定的文件</pre>
 *
 * <p>注意这条错误是 <b>FILE_NOT_FOUND</b> 而非格式错——Node 装了、npx 也在 PATH 里，
 * 只是没人替 Java 做 shell 会做的那步扩展名补全。所以这里按
 * {@code PATH} × {@code PATHEXT} 解析出完整路径再交给 ProcessBuilder。
 *
 * <p>非 Windows 原样透传：POSIX 的 {@code execvp} 本就会查 PATH，多此一举反而可能选错。
 */
public final class StdioCommand {

    private StdioCommand() {}

    /** PATHEXT 缺失时的兜底（与 Windows 默认值一致）。 */
    private static final String DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

    /** 生产入口：从真实环境取 os.name / PATH / PATHEXT，用真实文件存在性判断。 */
    public static List<String> build(String command, List<String> args) {
        return build(command, args,
                System.getProperty("os.name", ""),
                System.getenv("PATH"),
                System.getenv("PATHEXT"),
                p -> Files.isRegularFile(Path.of(p)));
    }

    /**
     * 在 Windows 上把一个裸命令名解析成完整可执行文件路径；解析不到或非 Windows 返回 null。
     *
     * <p>供 MCP 之外的调用方复用（如沙箱要找 {@code powershell.exe}）——
     * 「Windows 上按 PATH × PATHEXT 找可执行文件」这件事跟 MCP 无关，
     * 只是恰好先在这里被需要。
     */
    public static String resolveExecutable(String command) {
        String osName = System.getProperty("os.name", "");
        if (!isWindows(osName)) return null;
        return resolveOnWindows(command, System.getenv("PATH"), System.getenv("PATHEXT"),
                p -> Files.isRegularFile(Path.of(p)));
    }

    /**
     * 可测版本：环境全部注入，便于在 mac 上验证 Windows 分支。
     *
     * @param exists 判定某个绝对路径是否是一个存在的文件
     */
    static List<String> build(String command, List<String> args, String osName,
                              String pathEnv, String pathExt, Predicate<String> exists) {
        List<String> out = new ArrayList<>();
        String resolved = isWindows(osName) ? resolveOnWindows(command, pathEnv, pathExt, exists) : null;
        // 解析不到就原样交回去 —— 让操作系统报它自己的错，
        // 那比我们编一句「找不到 npx」更准（可能是权限、可能是别的）。
        out.add(resolved != null ? resolved : command);
        if (args != null) out.addAll(args);
        return out;
    }

    /**
     * Windows 上解析失败时给出的<b>追加</b>诊断；不适用（非 Windows / 解析成功）时返回 {@code ""}。
     *
     * <p>{@link #build} 解析不到时刻意原样把裸命令交给 OS —— 让它报自己的错比我们编一句
     * 「找不到 npx」更准（可能是权限、可能是别的）。但那样会丢掉最有用的一条信息，
     * 而它恰好区分了两种处境完全不同的情况：
     *
     * <ul>
     *   <li>Node 没装 / 不在 PATH → 该去装 Node</li>
     *   <li><b>装了，但当前进程继承的是旧 PATH</b>（装完 Node 没重启 wraith，或用 nvm-windows
     *       装的）→ 该<b>重启 wraith</b>。这一种在 Windows 上极常见，而 OS 的
     *       「系统找不到指定的文件」完全指不出来</li>
     * </ul>
     *
     * <p>所以不抢 OS 的准确性，只在解析确实失败时追加一句。
     */
    public static String windowsResolutionHint(String command) {
        return windowsResolutionHint(command,
                System.getProperty("os.name", ""),
                System.getenv("PATH"),
                System.getenv("PATHEXT"),
                p -> Files.isRegularFile(Path.of(p)));
    }

    /** 可测版本：环境全部注入，便于在 mac 上验证 Windows 分支。 */
    static String windowsResolutionHint(String command, String osName, String pathEnv,
                                        String pathExt, Predicate<String> exists) {
        if (command == null || command.isBlank() || !isWindows(osName)) {
            return "";
        }
        if (resolveOnWindows(command, pathEnv, pathExt, exists) != null) {
            return "";   // 能解析到就别制造噪音
        }
        return "[wraith] 在当前进程的 PATH 上没有找到 " + command
                + "（也试过 PATHEXT 里的 .cmd/.exe 等后缀）。"
                + "如果你确认已经装了它，最常见的原因是 wraith 启动时继承的是旧 PATH ——"
                + "重启 wraith 再试一次；用 nvm 之类版本管理器装的，也要重启后才会被继承。";
    }

    /** 见 {@code ShellCommand.isWindows} 的说明：用前缀而非 {@code contains("win")}，因为 "Darwin" 里含 "win"。 */
    static boolean isWindows(String osName) {
        return osName != null && osName.toLowerCase(Locale.ROOT).startsWith("windows");
    }

    /**
     * 按 PATH × PATHEXT 找出真正的可执行文件；找不到返回 null。
     *
     * <p>命令若已带路径分隔符或已带扩展名，就不再猜——那是用户明确指定的东西。
     */
    static String resolveOnWindows(String command, String pathEnv, String pathExt, Predicate<String> exists) {
        if (command == null || command.isBlank()) return null;
        String cmd = command.trim();

        // 已经是路径:只在没有扩展名时补 PATHEXT,不去 PATH 里瞎找
        if (cmd.contains("\\") || cmd.contains("/")) {
            if (hasExtension(cmd)) return exists.test(cmd) ? cmd : null;
            for (String ext : extensions(pathExt)) {
                if (exists.test(cmd + ext)) return cmd + ext;
            }
            return null;
        }

        // 裸名:PATH 的每一段 × PATHEXT 的每一个后缀
        if (pathEnv == null || pathEnv.isBlank()) return null;
        boolean hasExt = hasExtension(cmd);
        for (String dir : pathEnv.split(";")) {          // ⚠ Windows 用 ; 分隔,不是 :
            String d = dir.trim();
            if (d.isEmpty()) continue;
            String base = d.endsWith("\\") || d.endsWith("/") ? d + cmd : d + "\\" + cmd;
            if (hasExt) {
                if (exists.test(base)) return base;
                continue;
            }
            for (String ext : extensions(pathExt)) {
                if (exists.test(base + ext)) return base + ext;
            }
        }
        return null;
    }

    /** 末段里带点即视为有扩展名（避免把 `foo.bar\baz` 的目录点误判成扩展名）。 */
    private static boolean hasExtension(String cmd) {
        int slash = Math.max(cmd.lastIndexOf('\\'), cmd.lastIndexOf('/'));
        return cmd.indexOf('.', slash + 1) >= 0;
    }

    /** PATHEXT 拆成有序后缀列表（保持 Windows 自身的优先级：.COM 先于 .EXE 先于 .CMD）。 */
    private static List<String> extensions(String pathExt) {
        String raw = pathExt == null || pathExt.isBlank() ? DEFAULT_PATHEXT : pathExt;
        List<String> out = new ArrayList<>();
        for (String e : raw.split(";")) {
            String t = e.trim();
            if (t.isEmpty()) continue;
            out.add(t.startsWith(".") ? t : "." + t);
        }
        return out;
    }
}
