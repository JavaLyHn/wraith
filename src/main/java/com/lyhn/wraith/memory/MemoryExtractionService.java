package com.lyhn.wraith.memory;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
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

        // 已在待确认队列中的事实内容快照(按项目可见性)。候选批准前不进长期记忆,
        // 仅靠长期去重挡不住重复点击「整理记忆」/多次会话边界抽取把同一候选反复入队 ——
        // 故与长期去重互补:此处先挡掉已在 pending 里的内容。
        Set<String> alreadyPending = new HashSet<>();
        for (PendingFact pf : pendingStore.list(projectKey)) {
            alreadyPending.add(pf.fact());
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
            if (alreadyPending.contains(fact)) {
                continue; // 已在待确认队列(或本批已入队)→ 跳过,防重复点击膨胀
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
            alreadyPending.add(fact); // 记入本批,挡同批内的重复候选
            enqueued++;
        }
        return enqueued;
    }
}
