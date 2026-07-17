package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.LongSupplier;

/**
 * 四级水位线编排(spec §1/§2):判档 → Tier1 Snip → Tier2 Prune → 仍 ≥95% 交 tier3Fallback。
 * 一切异常内部吞掉并 log(治理绝不拖垮主循环);事件通过 eventOut 外发。
 */
public final class ContextCurator {
    private static final Logger log = LoggerFactory.getLogger(ContextCurator.class);

    private final WatermarkGauge gauge;
    private final ToolTierPolicy policy;
    private final CurationStats stats;
    private final BiConsumer<String, Map<String, Object>> eventOut;
    private final LongSupplier windowSupplier;

    public ContextCurator(LongSupplier windowSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut) {
        this.windowSupplier = windowSupplier;
        this.gauge = new WatermarkGauge(windowSupplier);
        this.policy = policy;
        this.stats = new CurationStats(sink);
        this.eventOut = eventOut;
    }

    public CurationStats stats() { return stats; }

    /** LLM 响应到达后调用:锚定真实水位 + metrics 行 + watermark 事件。 */
    public void onUsage(long input, long output, long cached, List<Message> history) {
        try {
            long estNow = TokenBudget.estimateMessagesTokens(history);
            gauge.onRealUsage(input, estNow);
            WatermarkGauge.Reading r = gauge.read(estNow);
            stats.recordUsage(input, output, cached, r);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("usedTokens", r.usedTokens());
            p.put("window", r.window());
            p.put("ratio", r.ratio());
            p.put("tier", r.tier());
            eventOut.accept("context.watermark", p);
        } catch (Exception e) {
            log.warn("context watermark record failed: {}", e.getClass().getSimpleName());
        }
    }

    /** 调 LLM 前治理。返回是否发生任何动作。 */
    public boolean curate(List<Message> history, Runnable tier3Fallback) {
        try {
            long estBefore = TokenBudget.estimateMessagesTokens(history);
            WatermarkGauge.Reading r = gauge.read(estBefore);
            if (r.tier() == 0) return false;

            long start = System.nanoTime();
            long target = gauge.tokensToRelease(r);
            int protectedFrom = ProtectionBoundary.protectedFrom(
                    history, ProtectionBoundary.protectedBudget(r.window()));

            List<SnipPass.Change> all = new ArrayList<>();
            SnipPass.Result snip = SnipPass.apply(history, protectedFrom, policy, target);
            all.addAll(snip.changes());
            int pruned = 0;
            long releasedSoFar = snip.releasedEstTokens();
            if (r.tier() >= 2 && releasedSoFar < target) {
                SnipPass.Result prune = PrunePass.apply(history, protectedFrom, policy, target - releasedSoFar);
                all.addAll(prune.changes());
                pruned = prune.changes().size();
                releasedSoFar += prune.releasedEstTokens();
            }

            boolean summarized = false;
            long estAfterPasses = TokenBudget.estimateMessagesTokens(history);
            if (r.tier() >= 3 && gauge.read(estAfterPasses).tier() >= 3 && tier3Fallback != null) {
                tier3Fallback.run();   // Phase A:旧 ConversationHistoryCompactor 代位;Phase B 换增量摘要
                summarized = true;
            }

            long estAfter = TokenBudget.estimateMessagesTokens(history);
            int snipped = snip.changes().size();
            if (snipped == 0 && pruned == 0 && !summarized) return false;

            long durationMs = (System.nanoTime() - start) / 1_000_000;
            stats.recordCompaction(r.tier(), estBefore, estAfter, snipped, pruned, summarized, durationMs);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("tier", r.tier());
            p.put("beforeTokens", estBefore);
            p.put("afterTokens", estAfter);
            p.put("snipped", snipped);
            p.put("pruned", pruned);
            p.put("summarized", summarized);
            p.put("savedTokens", Math.max(0, estBefore - estAfter));
            p.put("durationMs", durationMs);
            List<Map<String, Object>> items = new ArrayList<>();
            for (SnipPass.Change c : all) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("index", c.index());
                if (c.tool() != null) item.put("tool", c.tool());
                item.put("releasedEstTokens", c.releasedEstTokens());
                if (c.logPath() != null) item.put("logPath", c.logPath());
                items.add(item);
            }
            p.put("items", items);
            eventOut.accept("context.compaction", p);
            log.info("context curated: tier={} est {} -> {}, snipped={}, pruned={}, summarized={}",
                    r.tier(), estBefore, estAfter, snipped, pruned, summarized);
            return true;
        } catch (Exception e) {
            log.warn("context curation failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }
}
