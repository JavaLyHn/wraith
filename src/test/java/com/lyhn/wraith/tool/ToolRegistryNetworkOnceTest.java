package com.lyhn.wraith.tool;

import com.lyhn.wraith.hitl.*;
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
    void hitlApprovalWithNetworkGrantsThenCleansUpOnEarlyExit(@TempDir Path dir) {
        java.util.concurrent.atomic.AtomicBoolean granted = new java.util.concurrent.atomic.AtomicBoolean();
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
        HitlToolRegistry reg = new HitlToolRegistry(h) {
            @Override public void grantNetworkOnce() { granted.set(true); super.grantNetworkOnce(); }
        };
        reg.setProjectPath(dir.toString());
        reg.executeToolOutput("execute_command", "{\"command\":\"\"}"); // 空命令在消费点之前早退
        assertTrue(granted.get(), "批准且 allowNetworkOnce=true 应触发 grant");
        assertFalse(reg.consumeNetworkOnce(), "早退后标记必须被 finally 兜底清除,不得漂移到下一条命令");
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
