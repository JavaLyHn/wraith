package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * context.state.get 的 metrics JSONL 会话聚合(spec Phase C §5②⑥):
 * usage 行求和(compaction 行/坏行跳过)、成本单币累计(混币/零条缺席——宁缺勿虚)、
 * 尾行恢复 usedTokens 并按**当前** window 重算 ratio/tier(总 spec §6:窗口可能已随换模型改变)。
 * 一切失败原样返回 core,不抛。
 */
public final class ContextStateAggregator {
    private ContextStateAggregator() {}

    public static void merge(Map<String, Object> core, Path metricsFile, long currentWindow) {
        if (metricsFile == null || !Files.isRegularFile(metricsFile)) return;
        try {
            long in = 0, out = 0, cached = 0;
            double costSum = 0;
            Set<String> currencies = new LinkedHashSet<>();
            ObjectMapper om = new ObjectMapper();
            JsonNode last = null;
            java.util.List<Map<String, Object>> compactions = new java.util.ArrayList<>();
            for (String line : Files.readAllLines(metricsFile)) {
                if (line.isBlank()) continue;
                try {
                    JsonNode n = om.readTree(line);
                    if (n.has("compaction")) {
                        // 压缩行不计入 usage 累计,但据此重建「压缩历史」——否则重开应用后历史全空(桌面 reducer 的
                        // compactions[] 只由 live 事件累积,不跨进程持久)。tool 明细(items)未落盘,重建条目不含展开项。
                        long before = n.path("beforeTokens").asLong(0);
                        long after = n.path("afterTokens").asLong(0);
                        Map<String, Object> c = new java.util.LinkedHashMap<>();
                        c.put("ts", n.path("ts").asLong(0));
                        c.put("tier", n.path("tier").asInt(0));
                        c.put("beforeTokens", before);
                        c.put("afterTokens", after);
                        c.put("snipped", n.path("snipped").asInt(0));
                        c.put("pruned", n.path("pruned").asInt(0));
                        c.put("summarized", n.path("summarized").asBoolean(false));
                        c.put("savedTokens", Math.max(0, before - after));
                        if (n.has("manual")) c.put("manual", n.path("manual").asBoolean(false));
                        compactions.add(c);
                        continue;
                    }
                    in += n.path("inputTokens").asLong(0);
                    out += n.path("outputTokens").asLong(0);
                    cached += n.path("cachedInputTokens").asLong(0);
                    if (n.has("cost")) {
                        costSum += n.path("cost").asDouble(0);
                        currencies.add(n.path("currency").asText(""));
                    }
                    last = n;
                } catch (Exception ignored) { /* 坏行跳过 */ }
            }
            // 压缩历史独立于 usage 行:即便本会话只有压缩行(无 usage),也要回灌历史,故置于 last==null 守卫之前。
            if (!compactions.isEmpty()) core.put("compactions", compactions);
            if (last == null) return;
            core.put("inputTokens", in);
            core.put("outputTokens", out);
            core.put("cachedInputTokens", cached);
            long used = last.path("inputTokens").asLong(0);   // 该次请求真实上下文用量=水位分子
            double ratio = (double) used / Math.max(1L, currentWindow);
            core.put("usedTokens", used);
            core.put("ratio", ratio);
            core.put("tier", com.lyhn.wraith.context.curator.WatermarkGauge.tierOf(ratio));
            core.put("estimated", false);
            if (currencies.size() == 1 && costSum > 0) {
                String symbol = "USD".equalsIgnoreCase(currencies.iterator().next()) ? "$" : "¥";
                core.put("estimatedCost", String.format(Locale.ROOT, "%s%.4f", symbol, costSum));
            } else {
                core.remove("estimatedCost");   // 混币/无 cost 行:宁缺勿虚(core 里 in-process 零值也一并摘除)
            }
        } catch (Exception e) {
            // 聚合失败不影响快照主体
        }
    }
}
