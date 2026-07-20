package com.lyhn.wraith.runtime.appserver;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ContextStateAggregatorTest {

    private static Map<String, Object> core() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("estimated", true);
        m.put("estimatedCost", "¥0.0000");
        return m;
    }

    @Test
    void aggregatesUsageAndRecalculatesRatioAgainstCurrentWindow(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, """
                {"ts":1,"step":1,"inputTokens":10000,"outputTokens":100,"cachedInputTokens":2000,"ratio":0.9,"tier":3,"cost":0.5,"currency":"CNY"}
                {"ts":2,"compaction":true,"tier":1,"beforeTokens":9,"afterTokens":5,"snipped":1,"pruned":0,"summarized":false,"durationMs":3}
                bad line not json
                {"ts":3,"step":2,"inputTokens":50000,"outputTokens":200,"cachedInputTokens":40000,"ratio":0.9,"tier":3,"cost":1.5,"currency":"CNY"}
                """);
        Map<String, Object> m = core();
        // 关键:窗口从旧模型 64k 换成 1M——尾行 ratio 0.9 必须按当前窗口重算,不得直取
        ContextStateAggregator.merge(m, f, 1_000_000L);
        assertEquals(60_000L, m.get("inputTokens"));
        assertEquals(300L, m.get("outputTokens"));
        assertEquals(42_000L, m.get("cachedInputTokens"));
        assertEquals(50_000L, m.get("usedTokens"), "usedTokens 从尾行 inputTokens 恢复");
        assertEquals(0.05, (double) m.get("ratio"), 1e-9, "ratio 必须按当前 window 重算");
        assertEquals(0, m.get("tier"), "重算后 5% → tier0,不得沿用尾行 tier3");
        assertEquals(false, m.get("estimated"));
        assertEquals("¥2.0000", m.get("estimatedCost"));
    }

    @Test
    void mixedCurrenciesDropCostKey(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, """
                {"ts":1,"step":1,"inputTokens":100,"outputTokens":1,"cachedInputTokens":0,"ratio":0.1,"tier":0,"cost":0.5,"currency":"CNY"}
                {"ts":2,"step":2,"inputTokens":100,"outputTokens":1,"cachedInputTokens":0,"ratio":0.1,"tier":0,"cost":0.5,"currency":"USD"}
                """);
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 100_000L);
        assertFalse(m.containsKey("estimatedCost"), "混币宁缺勿虚");
    }

    @SuppressWarnings("unchecked")
    @Test
    void rebuildsCompactionHistoryFromMetricsLines(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, """
                {"ts":10,"step":1,"inputTokens":9000,"outputTokens":100,"cachedInputTokens":0,"ratio":0.7,"tier":1}
                {"ts":20,"compaction":true,"tier":1,"beforeTokens":9000,"afterTokens":6000,"snipped":3,"pruned":0,"summarized":false,"durationMs":5,"manual":false}
                {"ts":30,"compaction":true,"tier":0,"beforeTokens":7000,"afterTokens":5000,"snipped":0,"pruned":2,"summarized":true,"durationMs":40,"manual":true}
                """);
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 128_000L);
        Object comps = m.get("compactions");
        assertNotNull(comps, "快照须带 compactions 历史(重开应用后恢复)");
        var list = (java.util.List<Map<String, Object>>) comps;
        assertEquals(2, list.size(), "两条压缩行都要重建");
        assertEquals(6000L, list.get(0).get("afterTokens"));
        assertEquals(3000L, list.get(0).get("savedTokens"), "savedTokens=before-after");
        assertEquals(false, list.get(0).get("manual"));
        assertEquals(true, list.get(1).get("manual"), "手动标记须保留");
        assertEquals(true, list.get(1).get("summarized"));
        // 压缩行不得污染 usage 累计
        assertEquals(9000L, m.get("inputTokens"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void compactionHistorySurvivesEvenWithNoUsageLine(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, "{\"ts\":1,\"compaction\":true,\"tier\":2,\"beforeTokens\":8000,\"afterTokens\":4000,\"snipped\":2,\"pruned\":1,\"summarized\":false,\"durationMs\":7,\"manual\":true}\n");
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 128_000L);
        // last==null(无 usage 行)时也要回灌历史——置于 last==null 守卫之前
        var list = (java.util.List<Map<String, Object>>) m.get("compactions");
        assertNotNull(list);
        assertEquals(1, list.size());
        assertFalse(m.containsKey("usedTokens"), "无 usage 行:不捏造水位");
    }

    @Test
    void missingFileLeavesCoreUntouched(@TempDir Path dir) {
        Map<String, Object> m = core();
        Map<String, Object> snapshot = new LinkedHashMap<>(m);
        ContextStateAggregator.merge(m, dir.resolve("nope.jsonl"), 100_000L);
        assertEquals(snapshot, m);
    }

    @Test
    void usageRowsWithoutCostYieldNoCostKey(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, "{\"ts\":1,\"step\":1,\"inputTokens\":100,\"outputTokens\":1,\"cachedInputTokens\":0,\"ratio\":0.1,\"tier\":0}\n");
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 100_000L);
        assertFalse(m.containsKey("estimatedCost"));
        assertEquals(false, m.get("estimated"));
    }
}
