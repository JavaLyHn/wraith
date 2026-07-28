package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryExtractionServiceTest {

    private Supplier<String> seqIds() {
        AtomicInteger n = new AtomicInteger();
        return () -> "cand-" + n.incrementAndGet();
    }

    private MemoryExtractionService service(File dir, ContextCompressor compressor, MemoryRetriever retriever, PendingMemoryStore store) {
        return new MemoryExtractionService(compressor, retriever, store);
    }

    @Test
    void enqueuesNonDuplicateCandidates(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("用户偏好 Java 17", "项目用 Maven 构建"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(retriever.retrieveLongTerm(anyString(), anyInt(), any())).thenReturn(List.of()); // 无相似既有条
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(2, n);
        assertEquals(2, store.list("/proj").size());
        assertTrue(store.list("/proj").stream().allMatch(f -> "FACT".equals(f.type()) && "project".equals(f.scope())));
    }

    @Test
    void dropsExactDuplicateAndAttachesNearestForSimilar(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("用户偏好 Java 17", "用户住在旧金山"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        MemoryEntry exactDup = new MemoryEntry("e1", "用户偏好 Java 17", MemoryEntry.MemoryType.FACT, Map.of(), 5);
        MemoryEntry similar = new MemoryEntry("e2", "用户住在纽约", MemoryEntry.MemoryType.FACT, Map.of(), 5);
        when(retriever.retrieveLongTerm(eq("用户偏好 Java 17"), anyInt(), any())).thenReturn(List.of(exactDup));
        when(retriever.retrieveLongTerm(eq("用户住在旧金山"), anyInt(), any())).thenReturn(List.of(similar));
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(1, n);                                            // 精确重复被丢,仅剩 1
        List<PendingFact> pending = store.list("/proj");
        assertEquals(1, pending.size());
        assertEquals("用户住在旧金山", pending.get(0).fact());
        assertEquals("e2", pending.get(0).nearestExistingId());        // 相似(非等)条挂为提示
    }

    @Test
    void dropsSensitiveCandidates(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("API key 是 sk-abc123def", "用户偏好深色主题"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(retriever.retrieveLongTerm(anyString(), anyInt(), any())).thenReturn(List.of());
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(1, n);                                            // sk- 候选被丢
        assertEquals("用户偏好深色主题", store.list("/proj").get(0).fact());
    }

    @Test
    void dropsChineseAndSpacedCredentials(@TempDir File dir) {
        List<String> mustDrop = List.of(
                "API key 是 sk-abc123def",
                "数据库密码是 abc123",
                "密钥: xyz789",
                "用户的 api key 是 xyz123",
                "password = hunter2",
                "访问令牌为 ghp_aaa111");
        List<String> mustKeep = List.of(
                "用户偏好深色主题",
                "项目用 Maven 构建",
                "用户偏好使用密码管理器 1Password");

        ContextCompressor compressor = mock(ContextCompressor.class);
        List<String> mixed = new java.util.ArrayList<>();
        mixed.addAll(mustDrop);
        mixed.addAll(mustKeep);
        when(compressor.extractFactCandidates(anyList())).thenReturn(mixed);
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(retriever.retrieveLongTerm(anyString(), anyInt(), any())).thenReturn(List.of());
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(mustKeep.size(), n);
        List<String> surviving = store.list("/proj").stream().map(PendingFact::fact).toList();
        assertEquals(mustKeep.size(), surviving.size());
        for (String keep : mustKeep) {
            assertTrue(surviving.contains(keep), "应保留: " + keep);
        }
        for (String drop : mustDrop) {
            assertFalse(surviving.contains(drop), "应过滤: " + drop);
        }
    }
}
