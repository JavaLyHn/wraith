package com.lyhn.wraith.policy.sandbox;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * {@code wraith sandbox doctor} —— 逐项体检并<b>真跑探针</b>。
 *
 * <p><b>为什么必须有这个命令：</b>Windows 的 AppContainer 那条链路（Win32 调用序列、
 * 管道 DACL、icacls 授权、工具链可读性）我一行都验不了——没有 Windows 机器。
 * 这是把验证能力交到用户手里的唯一办法：不是让他「试试看能不能用」，
 * 而是给出四条判据明确的探针，哪条不对一眼可见。
 *
 * <p>四条探针的设计意图各不相同：
 * <ol>
 *   <li>{@code echo} —— 证明 <b>stdio 管道通了</b>。这是最可能出问题的一环
 *       （AppContainer 令牌受限，默认 DACL 的管道可能读写被拒），
 *       症状是「命令跑完但零输出」，不单独探根本归不了因。</li>
 *   <li>工作区内写 —— 证明 ACL 授权生效，沙箱没把正常开发挡死。</li>
 *   <li>工作区外写 —— <b>期望失败</b>。成功就说明写围栏是假的。</li>
 *   <li>联网 —— <b>期望失败</b>。成功就说明断网是假的。</li>
 * </ol>
 *
 * <p>后两条「期望失败」是这套体检的重点：前两条绿只说明沙箱<b>没碍事</b>，
 * 只有后两条红→绿的翻转才说明它<b>真在拦</b>。
 */
public final class SandboxDoctor {

    private SandboxDoctor() {}

    private static final String OK_TOKEN = "wraith-sandbox-ok";
    private static final int PROBE_TIMEOUT_SECONDS = 30;

    public static boolean isCommand(String[] args) {
        return args != null && args.length >= 1 && "sandbox".equalsIgnoreCase(args[0]);
    }

    /** @return 进程退出码：0 表示沙箱可用且四条探针全部符合预期 */
    public static int run(String[] args) {
        String sub = args.length >= 2 ? args[1].toLowerCase(java.util.Locale.ROOT) : "doctor";
        if (!sub.equals("doctor")) {
            System.out.println("用法: wraith sandbox doctor");
            return 2;
        }
        return doctor();
    }

    private static int doctor() {
        String os = System.getProperty("os.name", "");
        SandboxKind kind = CommandSandbox.detect();

        System.out.println("wraith 命令沙箱体检");
        System.out.println("────────────────────────────────────");
        System.out.println("平台      : " + os + " " + System.getProperty("os.version", ""));
        System.out.println("沙箱种类  : " + kind.wire());
        System.out.println();

        if (ShellCommand.isWindows(os)) {
            System.out.println("AppContainer 前置条件");
            AppContainerSupport.Diagnosis d = AppContainerSupport.diagnose();
            for (AppContainerSupport.Check c : d.checks()) {
                System.out.printf("  %s %-14s %s%n", c.ok() ? "✔" : "✘", c.name(), c.detail());
            }
            System.out.println();
        } else {
            boolean seatbelt = Files.isExecutable(Path.of("/usr/bin/sandbox-exec"));
            System.out.printf("  %s sandbox-exec   %s%n%n", seatbelt ? "✔" : "✘",
                    seatbelt ? "/usr/bin/sandbox-exec" : "不可执行");
        }

        if (!kind.sandboxed()) {
            System.out.println("结论: 无沙箱。" + CommandSandbox.noSandboxWarning(os));
            AppContainerSupport.Diagnosis d = AppContainerSupport.diagnose();
            if (d.reason() != null) {
                System.out.println("      缺失项: " + d.reason());
            }
            return 1;
        }

        Path workspace = Path.of("").toAbsolutePath();
        System.out.println("探针（工作区 " + workspace + "）");
        List<Probe> probes = buildProbes(os, workspace);
        boolean allOk = true;
        for (Probe p : probes) {
            Result r = runProbe(p, workspace);
            allOk &= r.pass();
            System.out.printf("  %s %-22s %s%n", r.pass() ? "✔" : "✘", p.name(), r.note());
        }

        System.out.println();
        if (allOk) {
            System.out.println("结论: 沙箱工作正常（写围栏与断网均已生效）。");
            return 0;
        }
        System.out.println("结论: 沙箱已启用但存在异常项，见上。"
                + "期望失败的探针若变成通过，说明对应围栏没有真正生效。");
        return 1;
    }

    /** @param expectSuccess 该探针期望子进程成功(true)还是期望被拦(false) */
    record Probe(String name, String command, boolean expectSuccess, String outputMustContain) {}

    static List<Probe> buildProbes(String osName, Path workspace) {
        boolean win = ShellCommand.isWindows(osName);
        // 工作区外的写目标:用户主目录。沙箱应当拦住它。
        Path outside = Path.of(System.getProperty("user.home"), ".wraith-sandbox-probe.tmp");

        List<Probe> out = new ArrayList<>();
        out.add(new Probe("stdio 管道", "echo " + OK_TOKEN, true, OK_TOKEN));

        if (win) {
            out.add(new Probe("工作区内可写",
                    "echo probe> .wraith-probe.tmp && del .wraith-probe.tmp", true, null));
            out.add(new Probe("工作区外拒写（期望失败）",
                    "echo probe> \"" + outside + "\"", false, null));
            // Windows 10 1803+ 自带 curl.exe
            out.add(new Probe("断网（期望失败）",
                    "curl -s -m 8 -o NUL https://example.com", false, null));
        } else {
            out.add(new Probe("工作区内可写",
                    "echo probe > .wraith-probe.tmp && rm -f .wraith-probe.tmp", true, null));
            out.add(new Probe("工作区外拒写（期望失败）",
                    "echo probe > '" + outside + "'", false, null));
            out.add(new Probe("断网（期望失败）",
                    "curl -s -m 8 -o /dev/null https://example.com", false, null));
        }
        return out;
    }

    record Result(boolean pass, String note) {}

    private static Result runProbe(Probe probe, Path workspace) {
        // 断网探针必须用「断网」沙箱,否则测的是另一回事
        CommandSandbox sandbox = new CommandSandbox(false);
        CommandSandbox.Wrapped w = sandbox.wrap(workspace.toString(), probe.command());
        try {
            ProcessBuilder pb = new ProcessBuilder(w.command());
            pb.directory(new File(workspace.toString()));
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out = new String(p.getInputStream().readAllBytes(),
                    ShellCommand.outputCharset());
            if (!p.waitFor(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return new Result(false, "超时（" + PROBE_TIMEOUT_SECONDS + "s）");
            }
            boolean succeeded = p.exitValue() == 0;

            if (probe.outputMustContain() != null) {
                boolean got = out.contains(probe.outputMustContain());
                if (!got) {
                    // 这是最有价值的一条诊断:退出码 0 但没有输出,几乎必然是管道 DACL 的问题
                    return new Result(false, succeeded
                            ? "退出码 0 但没拿到输出 —— 多半是管道未授权给 AppContainer"
                            : "命令失败，exit=" + p.exitValue());
                }
            }
            if (succeeded == probe.expectSuccess()) {
                return new Result(true, probe.expectSuccess() ? "通过" : "已被拦截（符合预期）");
            }
            return new Result(false, probe.expectSuccess()
                    ? "本应成功却失败了，exit=" + p.exitValue() + trimmed(out)
                    : "本应被拦截却成功了 —— 该围栏没有生效");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Result(false, "被中断");
        } catch (Exception e) {
            return new Result(false, "启动失败: " + e.getMessage());
        }
    }

    private static String trimmed(String out) {
        String s = out == null ? "" : out.strip();
        if (s.isEmpty()) return "";
        if (s.length() > 200) s = s.substring(0, 200) + "…";
        return "\n      " + s.replace("\n", "\n      ");
    }
}
