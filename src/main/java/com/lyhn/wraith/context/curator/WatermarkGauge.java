package com.lyhn.wraith.context.curator;

import java.util.function.LongSupplier;

/**
 * 真实 token 水位计:以最近一次 LLM 真实 usage 为锚,加上锚点之后 history 估算增量。
 * 真实优先、估算兜底;估算只承担相对量(spec §6 滞回口径)。
 */
public final class WatermarkGauge {
    public static final double TIER1 = threshold("wraith.context.tier1", 0.60);
    public static final double TIER2 = threshold("wraith.context.tier2", 0.80);
    public static final double TIER3 = threshold("wraith.context.tier3", 0.95);
    public static final double TARGET = threshold("wraith.context.target", 0.50);

    public record Reading(long usedTokens, long window, double ratio, int tier) {}

    private final LongSupplier windowSupplier;
    private long lastRealInput = -1;
    private long estimateAtReal = 0;

    public WatermarkGauge(LongSupplier windowSupplier) {
        this.windowSupplier = windowSupplier;
    }

    /** LLM 响应到达时调用:真实 inputTokens + 该次调用前 history 的估算值(作差分锚点)。 */
    public synchronized void onRealUsage(long inputTokens, long historyEstimateAtCall) {
        if (inputTokens <= 0) return;
        this.lastRealInput = inputTokens;
        this.estimateAtReal = historyEstimateAtCall;
    }

    public synchronized Reading read(long historyEstimateNow) {
        long window = Math.max(1, windowSupplier.getAsLong());
        long used = lastRealInput < 0
                ? historyEstimateNow
                : Math.max(0, lastRealInput + (historyEstimateNow - estimateAtReal));
        double ratio = (double) used / window;
        int tier = ratio >= TIER3 ? 3 : ratio >= TIER2 ? 2 : ratio >= TIER1 ? 1 : 0;
        return new Reading(used, window, ratio, tier);
    }

    /** 压回 TARGET 线所需释放的估算 token 量(≤0 表示无需释放)。 */
    public long tokensToRelease(Reading r) {
        return Math.max(0, r.usedTokens() - (long) Math.floor(r.window() * TARGET));
    }

    static double threshold(String prop, double dflt) {
        try {
            String v = System.getProperty(prop);
            return v == null ? dflt : Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return dflt;
        }
    }
}
