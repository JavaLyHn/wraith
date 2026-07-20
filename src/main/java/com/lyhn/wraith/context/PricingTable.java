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

    /**
     * exact=true(种子):modelName 必须与 modelKey 完全相等才算命中——核对过的是"这个确切标识符"，
     * 不是它的前缀家族。exact=false(config):modelName 以 modelKey 为前缀即命中，前缀的模糊范围是
     * 用户自己的选择,由用户承担("glm-5" 会覆盖 glm-5.1/glm-5.2 等所有变体)。
     */
    private record Entry(String modelKey, Price price, boolean exact) {
        boolean matches(String modelName) {
            // 大小写不敏感:模型标识符按惯例大小写无关(如 "DeepSeek-V4-Flash" 与种子 "deepseek-v4-flash"
            // 是同一模型)。此前用 equals/startsWith 大小写敏感,致混合大小写模型名永不命中种子价 → 成本静默缺席。
            // 归一不放松「精确=同一标识符」语义(只消除大小写噪声),不违反「宁缺勿虚」。
            String m = modelName.toLowerCase(java.util.Locale.ROOT);
            String k = modelKey.toLowerCase(java.util.Locale.ROOT);
            return exact ? m.equals(k) : m.startsWith(k);
        }
    }

    /**
     * 内置种子:精确匹配,仅收录实现时已对官方 pricing 页核准过的**确切模型标识符**。
     * 绝不用前缀——前缀会让未核对的变体(如 glm-5.1、glm-4.5-air)静默套用旗舰价,
     * 违反"宁缺勿虚"红线。这些变体在种子层永远落到缺席,除非用户在 config pricing 里自配
     * (config 支持前缀,见 Entry 上的注释)。
     *
     * 核对记录(2026-07-17,复审后补充):
     * - DeepSeek:直接读取 https://api-docs.deepseek.com/quick_start/pricing,数值与下方一致
     *   (deepseek-v4-flash / deepseek-v4-pro,均 USD)。
     * - GLM-4.5 / GLM-5:https://bigmodel.cn/pricing 为纯前端渲染页,WebFetch 拿不到内容;
     *   改用 WebSearch 交叉验证多个来源(含 docs.bigmodel.cn 模型说明页),
     *   GLM-4.5(¥0.8/¥0.8/¥2.0)与 GLM-5(¥20/¥20/¥60)多源一致,与下方数值相符。
     *   GLM 未公布 cache 折扣价 → cacheHit=cacheMiss(保守)。
     * - GLM-5.1(本仓库 GLMClient 的默认模型!):**核不到,不加种子**。多次 WebSearch/WebFetch
     *   互相矛盾——有来源报 ¥4/百万、有来源报 ¥20/百万(疑与 GLM-5 混淆或历史价);
     *   docs.z.ai/guides/overview/pricing(z.ai 国际站,非 bigmodel.cn 国内站)给出
     *   input $1.4/cached $0.26/output $4.4(USD),另一批第三方聚合站给的是
     *   $0.966/$3.036(USD)——同一模型两套不同数字,且国际站 USD 与国内站 CNY 端点本就不是
     *   同一计费口径。没有任何两个独立可信来源对得上,视为核不到,glm-5.1 在种子层缺席。
     *   实际影响:本仓库 GLM 默认模型就是 glm-5.1,开箱状态下状态栏不显示"估算"字段
     *   (这是故意的——错价比不显示更糟);要看到估算,用户需在 config pricing 里自配一条。
     */
    private static final List<Entry> SEEDS = List.of(
            new Entry("deepseek-v4-flash", new Price(0.0028, 0.14, 0.28, "USD"), true),
            new Entry("deepseek-v4-pro", new Price(0.003625, 0.435, 0.87, "USD"), true),
            new Entry("glm-4.5", new Price(0.8, 0.8, 2.0, "CNY"), true),
            new Entry("glm-5", new Price(20.0, 20.0, 60.0, "CNY"), true));

    private final List<Entry> entries = new ArrayList<>();

    public PricingTable(List<WraithConfig.PricingEntry> configEntries) {
        if (configEntries != null) {
            for (WraithConfig.PricingEntry e : configEntries) {
                if (e.getModelPrefix() == null || e.getModelPrefix().isBlank()) continue;
                entries.add(new Entry(e.getModelPrefix(),
                        new Price(e.getCacheHitPerM(), e.getCacheMissPerM(), e.getOutputPerM(), e.getCurrency()),
                        false));
            }
        }
        entries.addAll(SEEDS);   // config 在前:同长度时先命中用户口径
    }

    /** config 条目最长前缀优先;种子要求精确相等。config 先于种子(同长度时)。 */
    public Optional<Price> resolve(String modelName) {
        if (modelName == null) return Optional.empty();
        Entry best = null;
        for (Entry e : entries) {
            if (!e.matches(modelName)) continue;
            if (best == null || e.modelKey().length() > best.modelKey().length()) best = e;
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
