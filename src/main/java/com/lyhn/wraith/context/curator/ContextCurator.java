package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.context.PricingTable;
import com.lyhn.wraith.llm.LlmClient;
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
import java.util.function.Supplier;

/**
 * 四级水位线编排(spec §1/§2):判档 → Tier1 Snip → Tier2 Prune → 仍 ≥95% 交内化增量摘要(tier3)。
 * 摘要失败或处于冷却期时以 EMERGENCY prune 兜底(防兜);压完仍 ≥95% 一次性 noticeOut 提示(防报),
 * 绝不静默、绝不破保护区。一切异常内部吞掉并 log(治理绝不拖垮主循环);事件通过 eventOut 外发。
 */
public final class ContextCurator {
    private static final Logger log = LoggerFactory.getLogger(ContextCurator.class);

    private final WatermarkGauge gauge;
    private final ToolTierPolicy policy;
    private final CurationStats stats;
    private final BiConsumer<String, Map<String, Object>> eventOut;
    private final LongSupplier windowSupplier;
    private final Supplier<String> modelSupplier;
    private final CalibratedTokenCounter counter = new CalibratedTokenCounter();
    private final IncrementalSummarizer summarizer;
    private java.util.function.Consumer<String> noticeOut = s -> {};
    private int cooldown = 0;
    private boolean pressureNotified = false;
    private PricingTable pricingTable = new PricingTable(java.util.List.of());

    public ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier,
                          Supplier<LlmClient> clientSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut) {
        this(windowSupplier, modelSupplier, clientSupplier, policy, sink, eventOut, null);
    }

    /** 测试注入摘要器用重载。 */
    public ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier,
                          Supplier<LlmClient> clientSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut,
                          IncrementalSummarizer summarizer) {
        this.windowSupplier = windowSupplier;
        this.modelSupplier = modelSupplier;
        this.gauge = new WatermarkGauge(windowSupplier);
        this.policy = policy;
        this.stats = new CurationStats(sink);
        this.eventOut = eventOut;
        this.summarizer = summarizer != null ? summarizer
                : new IncrementalSummarizer(clientSupplier, counter);
    }

    public CurationStats stats() { return stats; }

    CalibratedTokenCounter counter() { return counter; }

    /** 手动压缩回报(spec Phase C §4):fallback null=未走兜底。
     *  before/afterTokens 为 counter 估算口径,供上层横幅复用(与事件一致)。 */
    public record ManualCompaction(boolean any, boolean summarized, String fallback,
                                   long beforeTokens, long afterTokens) {}

    /** 压不动时一次性提示(默认 no-op);Agent 侧接到渲染器输出通道。 */
    public void setNoticeOut(java.util.function.Consumer<String> out) {
        this.noticeOut = out == null ? s -> {} : out;
    }

    /** 设置计价表(默认空表)。 */
    public void setPricingTable(PricingTable pricingTable) {
        this.pricingTable = pricingTable == null ? new PricingTable(java.util.List.of()) : pricingTable;
    }

    /** 会话边界复位:清水位锚点/冷却/一次性提示位。校准系数(per-model,跨会话仍有效)与累计 stats(会话累计经 JSONL 聚合校正)不清。 */
    public void resetConversationState() {
        gauge.reset();
        cooldown = 0;
        pressureNotified = false;
    }

    private static int intProp(String prop, int dflt) {
        try {
            String v = System.getProperty(prop);
            return v == null ? dflt : Integer.parseInt(v);
        } catch (NumberFormatException e) { return dflt; }
    }

    /** LLM 响应到达后调用:锚定真实水位 + metrics 行 + watermark 事件。 */
    public void onUsage(long input, long output, long cached, List<Message> history) {
        try {
            String model = modelSupplier.get();
            long rawEst = TokenBudget.estimateMessagesTokens(history);
            counter.calibrate(model, input, rawEst);
            long estNow = counter.estimate(model, history);
            gauge.onRealUsage(model, input, estNow);
            WatermarkGauge.Reading r = gauge.read(model, estNow);
            Double cost = pricingTable.cost(model, input, output, cached).orElse(null);
            String currency = pricingTable.resolve(model).map(PricingTable.Price::currency).orElse(null);
            stats.recordUsage(input, output, cached, r, cost, currency);
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

    /**
     * 外部执行(Plan/Team 模式)收尾后刷新水位:这些模式不走 react 的 onUsage 埋点,
     * 主 history 已被 recordExternalTurn 追加却无真实 usage 可锚——按当前 history 估算重发
     * context.watermark(estimated=true),否则桌面/TUI 水位会卡在上次 react 的读数不动。
     * 不写 metrics(无真实 usage,宁缺勿虚),不锚 gauge(仅按上次真实锚点+估算差分读数)。
     */
    public void refreshEstimatedWatermark(List<Message> history) {
        try {
            String model = modelSupplier.get();
            long estNow = counter.estimate(model, history);
            WatermarkGauge.Reading r = gauge.read(model, estNow);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("usedTokens", r.usedTokens());
            p.put("window", r.window());
            p.put("ratio", r.ratio());
            p.put("tier", r.tier());
            p.put("estimated", true);
            eventOut.accept("context.watermark", p);
        } catch (Exception e) {
            log.warn("watermark refresh failed: {}", e.getClass().getSimpleName());
        }
    }

    /** 调 LLM 前治理。返回是否发生任何动作。 */
    public boolean curate(List<Message> history) {
        try {
            String model = modelSupplier.get();
            long estBefore = counter.estimate(model, history);
            WatermarkGauge.Reading r = gauge.read(model, estBefore);
            if (r.tier() == 0) { pressureNotified = false; return false; }

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
                pruned += prune.changes().size();
                releasedSoFar += prune.releasedEstTokens();
            }

            boolean summarized = false;
            String fallback = null;
            long estAfterPasses = counter.estimate(model, history);
            if (r.tier() >= 3 && gauge.read(model, estAfterPasses).tier() >= 3) {
                if (cooldown > 0) {
                    cooldown--;
                    fallback = "cooldown";
                    SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                            Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                    all.addAll(em.changes());
                    pruned += em.changes().size();
                } else if (summarizer.summarize(history, protectedFrom, model, r.window())) {
                    summarized = true;
                } else {
                    cooldown = intProp("wraith.context.summary.cooldown", 3);
                    fallback = "emergency";
                    SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                            Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                    all.addAll(em.changes());
                    pruned += em.changes().size();
                }
            }

            long estAfter = counter.estimate(model, history);
            // 压完仍 ≥95% → 一次性提示(绝不静默,也绝不破保护区)
            if (gauge.read(model, estAfter).tier() >= 3) {
                if (!pressureNotified) {
                    pressureNotified = true;
                    noticeOut.accept("⚠️ 上下文已满,零成本压缩手段已用尽,建议开新会话或收窄任务。");
                }
            } else {
                pressureNotified = false;
            }

            int snipped = snip.changes().size();
            if (snipped == 0 && pruned == 0 && !summarized && fallback == null) return false;

            long durationMs = (System.nanoTime() - start) / 1_000_000;
            stats.recordCompaction(r.tier(), estBefore, estAfter, snipped, pruned, summarized, durationMs, false);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("tier", r.tier());
            p.put("beforeTokens", estBefore);
            p.put("afterTokens", estAfter);
            p.put("snipped", snipped);
            p.put("pruned", pruned);
            p.put("summarized", summarized);
            if (fallback != null) p.put("fallback", fallback);
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

    /** 手动压缩(spec §7):force 跑 1+2+3,保护区不动;返回压缩结果与是否走兜底。
     *  beforeTokens/afterTokens 用**同一个 counter 估算器**测量,与 context.compaction 事件里
     *  的数字一致——避免上层横幅另用 Agent.estimateCurrentContextTokens() 造成两套口径打架。 */
    public ManualCompaction compactNow(List<Message> history) {
        try {
            String model = modelSupplier.get();
            long estBefore = counter.estimate(model, history);
            WatermarkGauge.Reading r = gauge.read(model, estBefore);
            long start = System.nanoTime();
            int protectedFrom = ProtectionBoundary.protectedFrom(
                    history, ProtectionBoundary.protectedBudget(r.window()));
            List<SnipPass.Change> all = new ArrayList<>();
            SnipPass.Result snip = SnipPass.apply(history, protectedFrom, policy, Long.MAX_VALUE);
            all.addAll(snip.changes());
            SnipPass.Result prune = PrunePass.apply(history, protectedFrom, policy, Long.MAX_VALUE);
            all.addAll(prune.changes());
            boolean summarized = false;
            String fallback = null;
            if (summarizer.summarize(history, protectedFrom, model, r.window())) {
                summarized = true;
            } else {
                cooldown = intProp("wraith.context.summary.cooldown", 3);
                fallback = "emergency";
                SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                        Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                all.addAll(em.changes());
            }
            long estAfter = counter.estimate(model, history);
            boolean any = !all.isEmpty() || summarized || fallback != null;
            if (any) {
                long durationMs = (System.nanoTime() - start) / 1_000_000;
                stats.recordCompaction(r.tier(), estBefore, estAfter,
                        snip.changes().size(), prune.changes().size(), summarized, durationMs, true);
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("tier", r.tier());
                p.put("manual", true);
                p.put("beforeTokens", estBefore);
                p.put("afterTokens", estAfter);
                p.put("summarized", summarized);
                if (fallback != null) p.put("fallback", fallback);
                p.put("savedTokens", Math.max(0, estBefore - estAfter));
                eventOut.accept("context.compaction", p);
            }
            return new ManualCompaction(any, summarized, fallback, estBefore, estAfter);
        } catch (Exception e) {
            log.warn("manual curation failed: {}", e.getClass().getSimpleName());
            return new ManualCompaction(false, false, null, 0, 0);
        }
    }
}
