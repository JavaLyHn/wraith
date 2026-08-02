package com.lyhn.wraith.policy.sandbox;

import java.nio.charset.Charset;
import java.nio.charset.IllegalCharsetNameException;
import java.nio.charset.UnsupportedCharsetException;
import java.util.List;
import java.util.Locale;

/**
 * 把一条命令包成**平台正确**的 shell 调用。
 *
 * <p><b>为什么需要这一层：</b>此前 {@code execute_command} 在所有平台都写死
 * {@code bash -c}（{@code ToolRegistry.resolveProcessCommand} 与
 * {@code CommandSandbox.buildCommand} 各一份），全程没有平台分支。
 * Windows 上能不能跑，完全取决于 {@code bash.exe} 是否恰好在 PATH——
 * 而 Git for Windows 默认只把 {@code <install>\cmd} 加进 PATH（内含 {@code git.exe}），
 * {@code bash.exe} 在 {@code <install>\bin}，<b>默认不在</b>。
 *
 * <p>与 {@code StdioCommand}（MCP 的 {@code npx} → {@code npx.cmd}）是同一病根：
 * 把 POSIX 的进程/shell 假设直接套到 Windows。区别在于那边是「解析可执行文件」，
 * 这边是「选对解释器」。
 *
 * <p><b>为什么 Windows 选 {@code cmd.exe} 而不是 PowerShell：</b>
 * {@code cmd.exe} 必然存在（PowerShell 可被组策略禁用甚至移除），启动快
 * （PowerShell 每条命令多 200–400ms），引号规则也比 {@code powershell -Command} 简单。
 * 代价是模型必须知道自己在跟 cmd 说话——所以系统提示要同步告知，
 * 否则它会照 POSIX 习惯吐 {@code ls -la}。
 *
 * <p>纯函数，环境全注入，便于在 macOS 上验证 Windows 分支。
 */
public final class ShellCommand {

    private ShellCommand() {}

    /** 生产入口：从真实环境取 os.name / ComSpec。 */
    public static List<String> wrap(String command) {
        return wrap(System.getProperty("os.name", ""), System.getenv("ComSpec"), command);
    }

    /**
     * 可测版本。
     *
     * @param osName  {@code os.name} 系统属性
     * @param comSpec {@code %ComSpec%}（Windows 上通常是 {@code C:\Windows\system32\cmd.exe}）；
     *                空则退到裸名 {@code cmd.exe}，交给 PATH 解析
     */
    static List<String> wrap(String osName, String comSpec, String command) {
        String cmd = command == null ? "" : command;
        if (!isWindows(osName)) {
            return List.of("bash", "-c", cmd);
        }
        String shell = (comSpec == null || comSpec.isBlank()) ? "cmd.exe" : comSpec.trim();
        // 刻意**不**手工加引号,交给 ProcessBuilder 自己 quote。
        //
        // 走一遍 cmd 的解析规则(`cmd /?` 里那两条)确认这样是对的:
        //   `npm install`  → 含空格,Java 补引号 → `cmd /c "npm install"`
        //                    2 个引号但引号间不是可执行文件名 → 落规则 2:去掉首尾引号 → `npm install`  ✓
        //   `echo "hi"`    → Java 见首字符非引号,整体补引号 → `cmd /c "echo "hi""`
        //                    4 个引号 → 落规则 2:去首引号 + 去最后一个引号 → `echo "hi"`             ✓
        //   `a & b`        → `&` 是特殊字符 → 落规则 2 → `a & b`,`&` 仍作分隔符生效                  ✓
        //   `dir`          → 无空格,Java 不加引号 → `cmd /c dir`                                    ✓
        //
        // 自己拼 `/s /c "..."` 看似更可控,但要依赖 JDK 内部的 needsEscaping/isQuoted
        // 判定「这个参数已经带引号了别再动」——那是实现细节,跨 JDK 版本可能变,
        // 失败方式比现在这条隐蔽得多。
        return List.of(shell, "/c", cmd);
    }

    /**
     * 判定是否 Windows。
     *
     * <p>用 {@code startsWith("windows")} 而不是常见的 {@code contains("win")}：
     * <b>"Darwin" 里含 "win"</b>。虽然 JVM 在 macOS 上报的 {@code os.name} 是
     * "Mac OS X" 而非 "Darwin"（所以旧写法在生产上不会咬人），但这颗雷不该留着——
     * 只要有人把 {@code uname -s} 的结果喂进来就炸。
     *
     * <p>Windows 的 {@code os.name} 全部形如 "Windows 10" / "Windows 11" /
     * "Windows Server 2022" / "Windows NT"，前缀判定既精确又够用。
     */
    public static boolean isWindows(String osName) {
        return osName != null && osName.toLowerCase(Locale.ROOT).startsWith("windows");
    }

    /**
     * 读取子进程输出该用的字符集。
     *
     * <p><b>为什么不能用 {@code Charset.defaultCharset()}：</b>JEP 400（Java 18）之后
     * 它恒为 UTF-8，而 Windows 控制台程序吐的是本地代码页（中文 Windows 是 GBK/936）。
     * 本项目虽然 {@code maven.compiler.target=17}，但捆绑 JRE 由宿主 jlink 产出，
     * 宿主装的是哪个 JDK 就是哪个——一旦 ≥18，中文输出必乱码。
     *
     * <p>{@code native.encoding}（Java 17+）报告的正是操作系统本地编码，不受 JEP 400 影响，
     * 正是为这种场景准备的。非 Windows 上两者一致，行为不变。
     */
    public static Charset outputCharset() {
        return outputCharset(System.getProperty("os.name", ""),
                System.getProperty("native.encoding"));
    }

    /** 可测版本。取不到或不认识 native.encoding 时退回 JVM 默认，绝不抛。 */
    static Charset outputCharset(String osName, String nativeEncoding) {
        if (!isWindows(osName) || nativeEncoding == null || nativeEncoding.isBlank()) {
            return Charset.defaultCharset();
        }
        try {
            return Charset.forName(nativeEncoding.trim());
        } catch (IllegalCharsetNameException | UnsupportedCharsetException e) {
            return Charset.defaultCharset();
        }
    }
}
