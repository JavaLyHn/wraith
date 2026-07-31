package com.lyhn.wraith.tool;

import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class MemoryToolsTest {

    private static MemoryManager manager(Path tmp) {
        return new MemoryManager(null, 4096, 128000, new LongTermMemory(tmp.resolve("memory-store").toFile()));
    }

    @Test
    void toolsFailHonestlyWhenManagerNotInjected() {
        ToolRegistry reg = new ToolRegistry();
        assertTrue(reg.executeTool("memory_list", "{}").startsWith("memory_list 失败"));
        assertTrue(reg.executeTool("memory_search", "{\"query\":\"x\"}").startsWith("memory_search 失败"));
        assertTrue(reg.executeTool("memory_delete", "{\"id\":\"x\"}").startsWith("memory_delete 失败"));
        assertTrue(reg.executeTool("memory_pending_list", "{}").startsWith("memory_pending_list 失败"));
    }

    @Test
    void listAndSearchAndDeleteRoundTrip(@TempDir Path tmp) {
        MemoryManager mm = manager(tmp);
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(mm);
        assertTrue(mm.storeFact("用户偏好中文回复", "project"));

        String listed = reg.executeTool("memory_list", "{}");
        assertTrue(listed.contains("用户偏好中文回复"), listed);

        String found = reg.executeTool("memory_search", "{\"query\":\"中文\"}");
        assertTrue(found.contains("用户偏好中文回复"), found);

        String id = mm.listLongTerm().get(0).getId();
        String deleted = reg.executeTool("memory_delete", "{\"id\":\"" + id + "\"}");
        assertFalse(deleted.startsWith("memory_delete 失败"), deleted);
        assertTrue(mm.listLongTerm().isEmpty(), "删除后长期记忆应为空");
    }

    @Test
    void deleteUnknownIdFails(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_delete", "{\"id\":\"no-such\"}").startsWith("memory_delete 失败"));
    }

    @Test
    void searchRejectsBlankQuery(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_search", "{\"query\":\"  \"}").startsWith("memory_search 失败"));
    }

    @Test
    void pendingListEmptyIsNotAFailure(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        String out = reg.executeTool("memory_pending_list", "{}");
        assertFalse(out.startsWith("memory_pending_list 失败"), out);
    }

    @Test
    void approveAndRejectUnknownIdFail(@TempDir Path tmp) {
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(manager(tmp));
        assertTrue(reg.executeTool("memory_pending_approve", "{\"id\":\"x\"}").startsWith("memory_pending_approve 失败"));
        assertTrue(reg.executeTool("memory_pending_reject", "{\"id\":\"x\"}").startsWith("memory_pending_reject 失败"));
    }
}
