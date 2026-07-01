package com.lyhn.wraith.tool;

import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class ToolRegistrySandboxWiringTest {

    @Test
    void noSandbox_runsPlainBash() {
        ToolRegistry reg = new ToolRegistry();
        assertEquals(List.of("bash", "-c", "echo hi"), reg.resolveProcessCommand("echo hi"));
    }

    @Test
    void withSandbox_wrapsWithSandboxExec() {
        assumeTrue(CommandSandbox.available(), "仅 macOS + sandbox-exec 环境验证包裹路径");
        ToolRegistry reg = new ToolRegistry();
        reg.setCommandSandbox(new CommandSandbox(false));
        List<String> cmd = reg.resolveProcessCommand("echo hi");
        assertEquals("/usr/bin/sandbox-exec", cmd.get(0));
        assertEquals(List.of("bash", "-c", "echo hi"), cmd.subList(cmd.size() - 3, cmd.size()));
    }
}
