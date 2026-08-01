package com.lyhn.wraith.tool;

import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class MemoryToolsTest {

    // MemoryManager()构造函数内部会 `new PendingMemoryStore()`(无参),它解析自己的目录
    // (系统属性 wraith.memory.dir 优先,否则真实 ~/.wraith/memory)。manager(tmp) 只把
    // LongTermMemory 重定向到临时目录,PendingMemoryStore 若不重定向,pending-list/approve/
    // reject 这几个测试就会读写开发机真实的候选记忆文件(本仓库已发生过测试写真实 config 的事故)。
    @TempDir Path pendingDirTmp;
    private String previousMemoryDirProperty;

    @BeforeEach
    void redirectPendingMemoryDir() {
        previousMemoryDirProperty = System.getProperty("wraith.memory.dir");
        System.setProperty("wraith.memory.dir", pendingDirTmp.toString());
    }

    @AfterEach
    void restorePendingMemoryDir() {
        if (previousMemoryDirProperty == null) {
            System.clearProperty("wraith.memory.dir");
        } else {
            System.setProperty("wraith.memory.dir", previousMemoryDirProperty);
        }
    }

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

    @Test
    void listIsDeterministicAndSortedNewestFirstByTimestamp(@TempDir Path tmp) {
        MemoryManager mm = manager(tmp);
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(mm);

        // getAll() 底层是 ConcurrentHashMap#values(),迭代顺序只取决于 id 的哈希桶,与内容/
        // 时间无关。插入 12 条、显式控制 timestamp(fact-0 最旧 ... fact-11 最新),不排序时
        // 输出顺序几乎不可能巧合地等于时间倒序(概率 1/12!),借此证明"显示前 N 条"曾经是假话。
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < 12; i++) {
            String id = "fact-" + i;
            ids.add(id);
            var entry = new com.lyhn.wraith.memory.MemoryEntry(id, "内容" + i,
                    com.lyhn.wraith.memory.MemoryEntry.MemoryType.FACT,
                    java.time.Instant.ofEpochSecond(1_000L * i),
                    java.util.Map.of("source", "fact", "scope", "global"), 4);
            mm.getLongTermMemory().store(entry);
        }

        String out1 = reg.executeTool("memory_list", "{\"limit\":50}");
        String out2 = reg.executeTool("memory_list", "{\"limit\":50}");
        assertEquals(out1, out2, "同一状态下两次调用的顺序必须一致(确定性)");

        int previousIndex = -1;
        for (int i = ids.size() - 1; i >= 0; i--) {
            int idx = out1.indexOf("[fact-" + i + "]");
            assertTrue(idx >= 0, "缺少 fact-" + i + ": " + out1);
            assertTrue(idx > previousIndex, "fact-" + i + " (更新) 应比更旧的记忆先出现: " + out1);
            previousIndex = idx;
        }
    }

    @Test
    void pendingStoreIsRedirectedAwayFromRealHomeDirectory(@TempDir Path tmp) throws Exception {
        MemoryManager mm = manager(tmp);
        ToolRegistry reg = new ToolRegistry();
        reg.setMemoryManager(mm);

        mm.getPendingStore().add(new com.lyhn.wraith.memory.PendingFact(
                "cand-isolation-test", "测试候选事实(隔离验证,不应落到真实 ~/.wraith)", "FACT",
                "global", null, "sess", null, java.time.Instant.now().toString()));

        String listed = reg.executeTool("memory_pending_list", "{}");
        assertTrue(listed.contains("cand-isolation-test"), listed);

        Path pendingFileInTmp = pendingDirTmp.resolve("pending_facts.json");
        assertTrue(java.nio.file.Files.exists(pendingFileInTmp),
                "候选记忆应落在重定向后的临时目录,而非真实 ~/.wraith/memory: " + pendingFileInTmp);

        Path realPendingFile = Path.of(System.getProperty("user.home"), ".wraith", "memory", "pending_facts.json");
        if (java.nio.file.Files.exists(realPendingFile)) {
            String content = java.nio.file.Files.readString(realPendingFile);
            assertFalse(content.contains("cand-isolation-test"),
                    "测试候选事实不应写进开发机真实的 ~/.wraith/memory/pending_facts.json");
        }
    }
}
