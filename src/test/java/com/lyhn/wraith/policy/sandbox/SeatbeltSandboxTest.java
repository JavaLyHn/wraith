package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** 真实 sandbox-exec 边界证明。仅 macOS。 */
class SeatbeltSandboxTest {

    private final CommandSandbox sandbox = new CommandSandbox(false);

    /** 在 cwd 下跑一条命令(可为沙箱化或裸命令),返回退出码;-1 表示异常/超时。 */
    private int run(List<String> command, Path cwd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(cwd.toFile());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        // 排空输出,避免管道阻塞
        p.getInputStream().readAllBytes();
        if (!p.waitFor(20, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            return -1;
        }
        return p.exitValue();
    }

    private int sandboxed(String shellCmd, Path ws) throws Exception {
        return run(sandbox.wrap(ws.toString(), shellCmd).command(), ws);
    }

    @Test
    void confinesWritesToWorkspaceAndTmpButNotOutsideNorGit() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        // workspace 放在 /tmp,刻意避开 $TMPDIR(/var/folders)
        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-sbx-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            Path outside = Files.createDirectory(base.resolve("outside"));
            Files.createDirectory(ws.resolve(".git"));

            // 1) workspace 内写:允许
            Path in = ws.resolve("in.txt");
            assertEquals(0, sandboxed("printf x > '" + in + "'", ws), "workspace 内写应成功");
            assertTrue(Files.exists(in));

            // 2) workspace 外写:拒绝(文件不应出现)
            Path out = outside.resolve("out.txt");
            assertNotEquals(0, sandboxed("printf x > '" + out + "'", ws), "workspace 外写应被拒");
            assertFalse(Files.exists(out), "越界文件不应被创建");

            // 3) .git 只读:拒绝
            Path gitProbe = ws.resolve(".git/probe");
            assertNotEquals(0, sandboxed("printf x > '" + gitProbe + "'", ws), ".git 写应被拒");
            assertFalse(Files.exists(gitProbe));

            // 4) $TMPDIR 内写:允许
            assertEquals(0, sandboxed(
                    "printf x > \"$TMPDIR/wraith_sbx_probe_$$\"", ws), "$TMPDIR 内写应成功");

            // 5) 宽松读:读 workspace 外文件应成功
            assertEquals(0, sandboxed("cat /etc/hosts > /dev/null", ws), "宽松读应允许读盘外");
        } finally {
            deleteRecursively(base);
        }
    }

    @Test
    void deniesNetworkWhileControlConnects() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-sbx-net-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            // 本地监听:内核会把连接放进 backlog,无需 accept 即可完成握手
            try (ServerSocket ss = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
                int port = ss.getLocalPort();
                String probe = "exec 3<>/dev/tcp/127.0.0.1/" + port;

                // 沙箱内:网络被拒 → 非 0
                assertNotEquals(0, sandboxed(probe, ws), "沙箱内网络连接应被拒");

                // 对照:裸 bash 同一探针 → 成功(证明目标可达,拦截来自沙箱而非环境)
                assertEquals(0, run(List.of("bash", "-c", probe), ws),
                        "裸跑同一探针应连通,反证拦截来自沙箱");
            }
        } finally {
            deleteRecursively(base);
        }
    }

    private static void deleteRecursively(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                .forEach(p -> { try { Files.deleteIfExists(p); } catch (Exception ignored) {} });
        }
    }
}
