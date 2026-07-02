package com.lyhn.wraith.hitl;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class HitlToolRegistryBeforeContentTest {

    /** 捕获 ApprovalRequest 后一律拒绝(不真正写文件)。 */
    static class CapturingHandler implements HitlHandler {
        ApprovalRequest captured;
        @Override public boolean isEnabled() { return true; }
        @Override public void setEnabled(boolean enabled) {}
        @Override public ApprovalResult requestApproval(ApprovalRequest request) {
            captured = request;
            return ApprovalResult.reject("test");
        }
        @Override public boolean isApprovedAllByTool(String toolName) { return false; }
        @Override public boolean isApprovedAllByServer(String serverName) { return false; }
        @Override public void clearApprovedAll() {}
        @Override public void clearApprovedAllForServer(String serverName) {}
    }
    // 注意:以 HitlHandler 实际接口为准(方法集与 RendererHitlHandler 的 @Override 一致);
    // 若有 default 方法可不覆写。

    private static HitlToolRegistry registry(CapturingHandler h, Path dir) {
        HitlToolRegistry reg = new HitlToolRegistry(h);
        reg.setProjectPath(dir.toString()); // 会重建 PathGuard
        return reg;
    }

    @Test
    void existingFileFillsBeforeContent(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("a.txt"), "old body");
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"a.txt\",\"content\":\"new\"}");
        assertNotNull(h.captured);
        assertEquals("old body", h.captured.beforeContent());
    }

    @Test
    void missingFileYieldsNullBeforeContent(@TempDir Path dir) {
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"nope.txt\",\"content\":\"new\"}");
        assertNotNull(h.captured);
        assertNull(h.captured.beforeContent());
    }

    @Test
    void oversizedFileYieldsNullBeforeContent(@TempDir Path dir) throws Exception {
        byte[] big = new byte[513 * 1024]; // > 512KB
        Files.write(dir.resolve("big.txt"), big);
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("write_file", "{\"path\":\"big.txt\",\"content\":\"new\"}");
        assertNull(h.captured.beforeContent());
    }

    @Test
    void nonWriteFileToolLeavesBeforeContentNull(@TempDir Path dir) {
        CapturingHandler h = new CapturingHandler();
        registry(h, dir).executeToolOutput("execute_command", "{\"command\":\"\"}");
        assertNotNull(h.captured);
        assertNull(h.captured.beforeContent());
    }
}
