package com.lyhn.wraith.context.curator;

import java.util.Locale;

/** 治理统计:面板取数源 + metrics JSONL 行(spec §9)。字段全数值,手拼 JSON 安全。 */
public final class CurationStats {
    private final CurationSink sink;
    private long step;
    private long totalSavedEst;
    private int totalSnipped;
    private int totalPruned;
    private int compactions;
    private long totalInput;
    private long totalOutput;
    private long totalCached;

    public CurationStats(CurationSink sink) { this.sink = sink; }

    public synchronized void recordUsage(long input, long output, long cached, WatermarkGauge.Reading r,
                                         Double cost, String currency) {
        step++;
        totalInput += Math.max(0, input);
        totalOutput += Math.max(0, output);
        totalCached += Math.max(0, cached);
        String costPart = cost == null ? "" : String.format(Locale.ROOT,
                ",\"cost\":%.6f,\"currency\":\"%s\"", cost, currency == null ? "CNY" : currency);
        sink.appendMetrics(String.format(Locale.ROOT,
                "{\"ts\":%d,\"step\":%d,\"inputTokens\":%d,\"outputTokens\":%d,\"cachedInputTokens\":%d,\"ratio\":%.4f,\"tier\":%d%s}",
                System.currentTimeMillis(), step, input, output, cached, r.ratio(), r.tier(), costPart));
    }

    public synchronized void recordCompaction(int tier, long before, long after,
                                              int snipped, int pruned, boolean summarized, long durationMs) {
        compactions++;
        totalSnipped += snipped;
        totalPruned += pruned;
        totalSavedEst += Math.max(0, before - after);
        sink.appendMetrics(String.format(Locale.ROOT,
                "{\"ts\":%d,\"compaction\":true,\"tier\":%d,\"beforeTokens\":%d,\"afterTokens\":%d,"
                        + "\"snipped\":%d,\"pruned\":%d,\"summarized\":%b,\"durationMs\":%d}",
                System.currentTimeMillis(), tier, before, after, snipped, pruned, summarized, durationMs));
    }

    public synchronized long totalSavedEst() { return totalSavedEst; }
    public synchronized int totalSnipped() { return totalSnipped; }
    public synchronized int totalPruned() { return totalPruned; }
    public synchronized int compactions() { return compactions; }
    public synchronized long totalInput() { return totalInput; }
    public synchronized long totalOutput() { return totalOutput; }
    public synchronized long totalCached() { return totalCached; }
}
