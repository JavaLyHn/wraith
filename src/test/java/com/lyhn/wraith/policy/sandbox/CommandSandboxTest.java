package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CommandSandboxTest {

    @Test
    void sandboxAvailable_wrapsWithSandboxExecAndProfile() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                true, false, "/ws", "/tmpd", "/ws/.git", "echo hi");

        assertTrue(w.sandboxed());
        assertNull(w.warning());
        List<String> c = w.command();
        assertEquals("/usr/bin/sandbox-exec", c.get(0));
        assertTrue(c.contains("WORKSPACE=/ws"));
        assertTrue(c.contains("GIT_DIR=/ws/.git"));
        assertEquals("-p", c.get(c.size() - 5));
        assertTrue(c.get(c.size() - 4).contains("(deny network*)"), "断网 profile 内联在 -p");
        assertEquals(List.of("bash", "-c", "echo hi"),
                c.subList(c.size() - 3, c.size()), "真实命令走 bash -c 尾部");
    }

    @Test
    void networkAllowed_profileHasNoNetworkDeny() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                true, true, "/ws", "/tmpd", "/ws/.git", "curl example.com");
        String profile = w.command().get(w.command().size() - 4);
        assertFalse(profile.contains("(deny network*)"));
    }

    @Test
    void notAvailable_failsOpenToPlainBashWithWarning() {
        CommandSandbox.Wrapped w = CommandSandbox.buildCommand(
                false, false, "/ws", "/tmpd", "/ws/.git", "echo hi");

        assertFalse(w.sandboxed());
        assertEquals(List.of("bash", "-c", "echo hi"), w.command());
        assertNotNull(w.warning());
        assertTrue(w.warning().contains("沙箱"), "fail-open 应带警告: " + w.warning());
    }

    @Test
    void constructorRemembersNetworkFlag() {
        assertTrue(new CommandSandbox(true).networkAllowed());
        assertFalse(new CommandSandbox(false).networkAllowed());
    }
}
