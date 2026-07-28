package com.lyhn.wraith.memory;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.function.Supplier;

/**
 * 会话边界自动记忆抽取编排:复用 ContextCompressor 抽取候选 → 去重/挂最相似提示 →
 * 敏感信息兜底 → 入 PendingMemoryStore 待确认。不直接写长期记忆。
 */
public class MemoryExtractionService {
    private static final Logger log = LoggerFactory.getLogger(MemoryExtractionService.class);

    private final ContextCompressor compressor;
    private final MemoryRetriever retriever;
    private final PendingMemoryStore pendingStore;

    public MemoryExtractionService(ContextCompressor compressor, MemoryRetriever retriever, PendingMemoryStore pendingStore) {
        this.compressor = compressor;
        this.retriever = retriever;
        this.pendingStore = pendingStore;
    }

    /**
     * 从会话切片抽取候选并入队。返回入队数。
     * idGen/nowIso 由调用方注入以便测试确定化。
     *
     * 空/null slice 的“返回 0”语义由 ContextCompressor.extractFactCandidates 自身的空输入短路保证
     * (真实实现对 null/空列表直接回 List.of()),此处不重复设置基于 slice 的前置短路 ——
     * 否则会在测试里绕过被 mock 的 compressor,与“逐候选去重/敏感过滤/入队”的验证意图相悖。
     */
    public int extractFromSession(List<MemoryEntry> slice, String sessionId, String projectKey,
                                  Supplier<String> idGen, String nowIso) {
        List<String> candidates;
        try {
            candidates = compressor.extractFactCandidates(slice);
        } catch (RuntimeException e) {
            log.warn("自动记忆抽取失败: {}", e.getMessage());
            return 0;
        }
        if (candidates == null || candidates.isEmpty()) {
            return 0;
        }

        int enqueued = 0;
        for (String fact : candidates) {
            if (fact == null || fact.isBlank()) {
                continue;
            }
            if (MemorySafety.isSensitive(fact)) {
                log.debug("敏感候选丢弃: {}", fact);
                continue;
            }
            String nearestId = null;
            List<MemoryEntry> similar = retriever.retrieveLongTerm(fact, 1, projectKey);
            if (similar != null && !similar.isEmpty()) {
                MemoryEntry top = similar.get(0);
                if (top.getContent().equals(fact)) {
                    continue; // 精确重复,丢弃不入队
                }
                nearestId = top.getId(); // 相似(非等)→ 挂提示,批准者定夺
            }
            pendingStore.add(new PendingFact(
                    idGen.get(), fact, "FACT", "project", nearestId, sessionId, projectKey, nowIso));
            enqueued++;
        }
        return enqueued;
    }
}
