package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** 经 execute_command 工具的端到端沙箱限定。仅 macOS。 */
class ExecuteCommandSandboxIntegrationTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static String cmdArgs(String command) {
        ObjectNode n = M.createObjectNode();
        n.put("command", command);
        return n.toString();
    }

    @Test
    void executeCommandConfinesWritesThroughSandbox() throws Exception {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec");

        Path base = Files.createTempDirectory(Path.of("/tmp"), "wraith-e2e-").toRealPath();
        try {
            Path ws = Files.createDirectory(base.resolve("ws"));
            Path outside = Files.createDirectory(base.resolve("outside"));

            ToolRegistry reg = new ToolRegistry();
            reg.setProjectPath(ws.toString());
            reg.setCommandSandbox(new CommandSandbox(false));

            // 1) workspace 内写:成功,文件落地
            Path in = ws.resolve("tool_in.txt");
            String okOut = reg.executeToolOutput(
                    "execute_command", cmdArgs("printf x > '" + in + "'")).text();
            assertTrue(Files.exists(in), "workspace 内写应落地: " + okOut);
            assertTrue(okOut.contains("exit code: 0"), "应报告 exit 0: " + okOut);

            // 2) workspace 外写:被沙箱拒,文件不落地
            Path out = outside.resolve("tool_out.txt");
            String denyOut = reg.executeToolOutput(
                    "execute_command", cmdArgs("printf x > '" + out + "'")).text();
            assertFalse(Files.exists(out), "越界文件不应被创建: " + denyOut);
            assertFalse(denyOut.contains("exit code: 0"), "越界写不应报告 exit 0: " + denyOut);
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
