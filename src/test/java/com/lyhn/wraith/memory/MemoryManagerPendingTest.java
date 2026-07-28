package com.lyhn.wraith.memory;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryManagerPendingTest {

    @AfterEach
    void cleanupSystemProperties() {
        // 避免跨测试类污染同一 JVM 的系统属性(见 controller decision 2)
        System.clearProperty("wraith.memory.dir");
        System.clearProperty("wraith.memory.autoExtract");
    }

    private MemoryManager managerWithTempMemory(File dir) {
        System.setProperty("wraith.memory.dir", dir.getAbsolutePath());
        LlmClient llm = mock(LlmClient.class);
        MemoryManager m = new MemoryManager(llm, 4000, 128000, new LongTermMemory(dir));
        m.setProjectPath("/proj");
        return m;
    }

    @Test
    void approveAddsToLongTerm(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.getPendingStore().add(new PendingFact("c1", "用户偏好 Java 17", "FACT", "project", null, "s1", m.getCurrentProject(), "2026-07-23T00:00:00Z"));
        assertEquals(1, m.listPending().size());

        assertTrue(m.approvePending("c1"));

        assertTrue(m.listPending().isEmpty());
        assertTrue(m.getLongTermMemory().getAll().stream().anyMatch(e -> e.getContent().equals("用户偏好 Java 17")));
    }

    @Test
    void approveReplacingSupersedesOld(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.storeFact("用户住在纽约", "global");
        String oldId = m.getLongTermMemory().getAll().get(0).getId();
        m.getPendingStore().add(new PendingFact("c2", "用户住在旧金山", "FACT", "global", oldId, "s1", null, "2026-07-23T00:00:00Z"));

        assertTrue(m.approvePendingReplacing("c2", oldId));

        List<MemoryEntry> all = m.getLongTermMemory().getAll();
        assertTrue(all.stream().anyMatch(e -> e.getContent().equals("用户住在旧金山")));
        assertTrue(all.stream().noneMatch(e -> e.getContent().equals("用户住在纽约"))); // 旧条被超请、检索过滤
        assertTrue(m.listPending().isEmpty());
    }

    @Test
    void rejectDropsWithoutStoring(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.getPendingStore().add(new PendingFact("c3", "临时废话", "FACT", "project", null, "s1", m.getCurrentProject(), "2026-07-23T00:00:00Z"));
        assertTrue(m.rejectPending("c3"));
        assertTrue(m.listPending().isEmpty());
        assertTrue(m.getLongTermMemory().getAll().isEmpty());
    }

    @Test
    void autoExtractDisabledSkips(@TempDir File dir) {
        System.setProperty("wraith.memory.autoExtract", "false");
        MemoryManager m = managerWithTempMemory(dir);
        m.getShortTermMemory().store(new MemoryEntry("user-1", "用户偏好 Java 17", MemoryEntry.MemoryType.CONVERSATION, java.util.Map.of(), 5));
        assertEquals(0, m.runAutoExtraction("s1")); // 关闭 → 不抽
    }
}
