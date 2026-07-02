package com.lyhn.wraith.tool;

import com.lyhn.wraith.hitl.*;
import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ToolRegistryNetworkOnceTest {

    @Test
    void grantIsConsumedOnce() {
        ToolRegistry reg = new ToolRegistry();
        assertFalse(reg.consumeNetworkOnce());
        reg.grantNetworkOnce();
        assertTrue(reg.consumeNetworkOnce());
        assertFalse(reg.consumeNetworkOnce(), "消费即清,第二次必须为 false");
    }

    @Test
    void resolveProcessCommandConsumesGrantEvenWithoutSandbox() {
        ToolRegistry reg = new ToolRegistry(); // 未注入沙箱
        reg.grantNetworkOnce();
        List<String> cmd = reg.resolveProcessCommand("echo hi");
        assertEquals(List.of("bash", "-c", "echo hi"), cmd);
        assertFalse(reg.consumeNetworkOnce(), "无沙箱也要消费,防泄漏到后续命令");
    }

    @Test
    void networkOverrideOmitsDenyNetworkInProfile() {
        // 走 CommandSandbox 静态构建验证 profile 语义(不依赖本机 sandbox-exec)
        CommandSandbox.Wrapped withNet = CommandSandbox.buildCommand(
                true, true, "/proj", "/tmp", null, "curl example.com");
        CommandSandbox.Wrapped noNet = CommandSandbox.buildCommand(
                true, false, "/proj", "/tmp", null, "curl example.com");
        String withNetJoined = String.join("\n", withNet.command());
        String noNetJoined = String.join("\n", noNet.command());
        assertFalse(withNetJoined.contains("(deny network*)"));
        assertTrue(noNetJoined.contains("(deny network*)"));
    }

    @Test
    void hitlApprovalWithNetworkTriggersGrant(@TempDir Path dir) {
        // 空命令让 executeCommand 在 resolveProcessCommand 之前早退 → 标记不被消费,可断言
        HitlHandler h = new HitlHandler() {
            @Override public boolean isEnabled() { return true; }
            @Override public void setEnabled(boolean enabled) {}
            @Override public ApprovalResult requestApproval(ApprovalRequest request) {
                return new ApprovalResult(ApprovalResult.Decision.APPROVED, null, null, true);
            }
            @Override public boolean isApprovedAllByTool(String toolName) { return false; }
            @Override public boolean isApprovedAllByServer(String serverName) { return false; }
            @Override public void clearApprovedAll() {}
            @Override public void clearApprovedAllForServer(String serverName) {}
        };
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString());
        reg.executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertTrue(reg.consumeNetworkOnce(), "批准且 allowNetworkOnce=true 应触发 grantNetworkOnce");
    }

    @Test
    void hitlApprovalWithoutNetworkDoesNotGrant(@TempDir Path dir) {
        HitlHandler h = new HitlHandler() {
            @Override public boolean isEnabled() { return true; }
            @Override public void setEnabled(boolean enabled) {}
            @Override public ApprovalResult requestApproval(ApprovalRequest request) {
                return ApprovalResult.approve(); // allowNetworkOnce=false
            }
            @Override public boolean isApprovedAllByTool(String toolName) { return false; }
            @Override public boolean isApprovedAllByServer(String serverName) { return false; }
            @Override public void clearApprovedAll() {}
            @Override public void clearApprovedAllForServer(String serverName) {}
        };
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString());
        reg.executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertFalse(reg.consumeNetworkOnce());
    }
}
