package com.lyhn.wraith.policy.sandbox;

import java.util.List;

/**
 * 拼出「经 PowerShell 发射器把命令送进 Windows AppContainer」的命令行。
 *
 * <p><b>为什么绕一层 PowerShell 而不是直接从 Java 调 Win32：</b>
 * AppContainer 的难点不是调 {@code CreateProcessAsUser}，是 <b>stdio</b>。
 * 走 JNA 的话得自建管道、把 Win32 {@code HANDLE} 循环 {@code ReadFile} 桥回 Java 的
 * {@code InputStream}，{@code ProcessBuilder} 现成的流处理全部作废——
 * 那是整件事里代码量最大、最易错的一段。
 *
 * <p>让 PowerShell 当发射器就绕开了：它自己的 stdout/stderr 就是 Java 给的管道，
 * 往下继承即可，<b>Java 侧一行不用改</b>。Win32 调用用 {@code Add-Type} 就地编译 C#，
 * 靠 Windows 自带的 .NET Framework 编译器，<b>不需要 MSVC / node-gyp</b>
 * ——与桌宠选 koffi 而非 node-gyp 是同一条理由。
 *
 * <p><b>为什么是两个 profile 而不是一个：</b>AppContainer 的能力集在
 * <b>创建 profile 时</b>定死，之后改不了。所以断网/联网各建一个，
 * {@code networkAllowed} 只决定用哪个——语义与 macOS 的
 * {@code (deny network*)} 开关完全一致。
 *
 * <p>纯函数，无 IO、无平台探测，可在 mac 上完整验证。
 */
public final class AppContainerCommand {

    private AppContainerCommand() {}

    /** 断网 profile：不带任何能力，内核直接拒绝 socket。 */
    public static final String PROFILE_NONET = "wraith-sandbox-nonet";

    /** 联网 profile：带 {@code internetClient} + {@code privateNetworkClientServer}。 */
    public static final String PROFILE_NET = "wraith-sandbox-net";

    public static String profileName(boolean networkAllowed) {
        return networkAllowed ? PROFILE_NET : PROFILE_NONET;
    }

    /**
     * @param powershell 已解析的 {@code powershell.exe} 完整路径；空则退到裸名交给 PATH
     * @param launcher   {@code appcontainer-run.ps1} 的完整路径
     * @param workspace  工作区根（会被授予 AppContainer 读写）
     * @param gitDir     {@code .git} 目录（会被显式拒写，对齐 Seatbelt 的 {@code .git} 只读）
     */
    public static List<String> build(String powershell, String launcher, boolean networkAllowed,
                                     String workspace, String gitDir, String command) {
        String ps = (powershell == null || powershell.isBlank()) ? "powershell.exe" : powershell.trim();
        return List.of(
                ps,
                // -NoProfile:用户的 $PROFILE 可能 Write-Host 一堆东西,会污染命令输出
                "-NoProfile",
                // -NonInteractive:发射器不该弹任何提示,卡住的话 agent 只能等到超时
                "-NonInteractive",
                // -ExecutionPolicy Bypass:默认 Restricted 会直接拒绝跑 .ps1;
                //   这是进程级参数,不改机器的组策略设置
                "-ExecutionPolicy", "Bypass",
                "-File", launcher == null ? "" : launcher,
                "-ProfileName", profileName(networkAllowed),
                "-Workspace", workspace == null ? "" : workspace,
                "-GitDir", gitDir == null ? "" : gitDir,
                // 参数名是 -CommandLine 而非 -Command:后者是 powershell.exe 自己的开关,
                // 同名会让「这个 -Command 是给谁的」变成一件需要推理的事。
                // 放最后:命令原文里什么都可能有,让它不必跟后续参数抢解析。
                "-CommandLine", command == null ? "" : command);
    }

    /**
     * 自检命令行：只建 profile / 授权 / 打印事实，<b>不执行任何用户命令</b>。
     * 供 {@code wraith sandbox doctor} 调用。
     */
    public static List<String> diagnose(String powershell, String launcher, boolean networkAllowed,
                                        String workspace, String gitDir) {
        String ps = (powershell == null || powershell.isBlank()) ? "powershell.exe" : powershell.trim();
        return List.of(
                ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", launcher == null ? "" : launcher,
                "-ProfileName", profileName(networkAllowed),
                "-Workspace", workspace == null ? "" : workspace,
                "-GitDir", gitDir == null ? "" : gitDir,
                "-Diag");
    }
}
