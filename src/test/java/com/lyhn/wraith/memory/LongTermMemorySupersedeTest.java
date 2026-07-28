package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class LongTermMemorySupersedeTest {

    private MemoryEntry fact(String id, String content) {
        return new MemoryEntry(id, content, MemoryEntry.MemoryType.FACT,
                Map.of("source", "fact", "scope", "global"), MemoryEntry.estimateTokens(content));
    }

    @Test
    void supersededExcludedFromGetAllAndSearchButKeptById(@TempDir File dir) {
        LongTermMemory ltm = new LongTermMemory(dir);
        ltm.store(fact("f1", "用户住在纽约"));
        ltm.store(fact("f2", "用户偏好深色主题"));

        assertTrue(ltm.markSuperseded("f1"));

        assertEquals(1, ltm.getAll().size());                                  // f1 被排除
        assertTrue(ltm.getAll().stream().noneMatch(e -> e.getId().equals("f1")));
        assertTrue(ltm.search("纽约", 10, null).isEmpty());                    // 检索不到 superseded
        assertFalse(ltm.search("深色", 10, null).isEmpty());                   // 未超请的仍在
        assertTrue(ltm.retrieve("f1").isPresent());                            // 按 id 仍可取(审计/删除)
        assertEquals("true", ltm.retrieve("f1").get().getMetadata().get("superseded"));
    }

    @Test
    void markSupersededMissingReturnsFalse(@TempDir File dir) {
        assertFalse(new LongTermMemory(dir).markSuperseded("nope"));
    }

    @Test
    void supersededSurvivesReload(@TempDir File dir) {
        LongTermMemory ltm = new LongTermMemory(dir);
        ltm.store(fact("f1", "旧事实"));
        ltm.markSuperseded("f1");
        LongTermMemory reloaded = new LongTermMemory(dir);
        assertTrue(reloaded.getAll().isEmpty());                               // 重载后仍被过滤
        assertTrue(reloaded.retrieve("f1").isPresent());                       // 仍在磁盘
    }
}
