package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 模型计价表(spec §4):config pricing(用户口径,最高优先)> 内置种子(官方牌价)> 缺席。
 * 未知模型不算成本——宁缺勿虚,0 意味着"免费"是错误信息。绝不自动联网搜价。
 */
public final class PricingTable {
    public record Price(double cacheHitPerM, double cacheMissPerM, double outputPerM, String currency) {}
    private record Entry(String modelPrefix, Price price) {}

    /**
     * 内置种子:仅收录实现时已对官方 pricing 页核准过的模型。
     * 核对记录(2026-07-17):
     * - DeepSeek:直接读取 https://api-docs.deepseek.com/quick_start/pricing,数值与下方一致
     *   (deepseek-v4-flash / deepseek-v4-pro,均 USD)。
     * - GLM:https://bigmodel.cn/pricing 为纯前端渲染页,WebFetch 拿不到内容;
     *   改用 WebSearch 交叉验证多个来源(含 docs.bigmodel.cn 模型说明页),
     *   GLM-4.5(¥0.8/¥0.8/¥2.0)与 GLM-5(¥20/¥20/¥60)与下方一致。
     *   GLM 未公布 cache 折扣价 → cacheHit=cacheMiss(保守)。
     */
    private static final List<Entry> SEEDS = List.of(
            new Entry("deepseek-v4-flash", new Price(0.0028, 0.14, 0.28, "USD")),
            new Entry("deepseek-v4-pro", new Price(0.003625, 0.435, 0.87, "USD")),
            new Entry("glm-4.5", new Price(0.8, 0.8, 2.0, "CNY")),
            new Entry("glm-5", new Price(20.0, 20.0, 60.0, "CNY")));

    private final List<Entry> entries = new ArrayList<>();

    public PricingTable(List<WraithConfig.PricingEntry> configEntries) {
        if (configEntries != null) {
            for (WraithConfig.PricingEntry e : configEntries) {
                if (e.getModelPrefix() == null || e.getModelPrefix().isBlank()) continue;
                entries.add(new Entry(e.getModelPrefix(),
                        new Price(e.getCacheHitPerM(), e.getCacheMissPerM(), e.getOutputPerM(), e.getCurrency())));
            }
        }
        entries.addAll(SEEDS);   // config 在前:同前缀时先命中用户口径
    }

    /** 最长前缀优先;config 条目先于种子。 */
    public Optional<Price> resolve(String modelName) {
        if (modelName == null) return Optional.empty();
        Entry best = null;
        for (Entry e : entries) {
            if (!modelName.startsWith(e.modelPrefix())) continue;
            if (best == null || e.modelPrefix().length() > best.modelPrefix().length()) best = e;
        }
        return best == null ? Optional.empty() : Optional.of(best.price());
    }

    public Optional<Double> cost(String modelName, long inputTokens, long outputTokens, long cachedInputTokens) {
        return resolve(modelName).map(p -> {
            long cached = Math.max(0, Math.min(inputTokens, cachedInputTokens));
            long miss = Math.max(0, inputTokens - cached);
            return (cached / 1_000_000.0) * p.cacheHitPerM()
                    + (miss / 1_000_000.0) * p.cacheMissPerM()
                    + (Math.max(0, outputTokens) / 1_000_000.0) * p.outputPerM();
        });
    }

    public Optional<String> formatCost(String modelName, long inputTokens, long outputTokens, long cachedInputTokens) {
        Optional<Price> p = resolve(modelName);
        if (p.isEmpty()) return Optional.empty();
        String symbol = "USD".equalsIgnoreCase(p.get().currency()) ? "$" : "¥";
        return cost(modelName, inputTokens, outputTokens, cachedInputTokens)
                .map(c -> String.format(Locale.ROOT, "%s%.4f", symbol, c));
    }
}
