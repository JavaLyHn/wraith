package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 校准估算 token 计数(spec §3):静态字符估算 × per-model EMA 校准系数。
 * 每次真实 usage 到来用 真实input÷当时原始估算 更新系数,修正 30-50% 系统性偏差;
 * 事前量(切批预算/释放目标/差分)全走这里。事前 100% 精确不存在——请求总量
 * 含 chat template/tools schema,只有 API usage 知道,触发判断仍以真实锚点为准。
 */
public final class CalibratedTokenCounter implements TokenCounter {
    private static final double ALPHA = 0.3;          // EMA 平滑
    private static final double MIN_F = 0.5, MAX_F = 3.0;  // 钳制荒谬观测

    private final Map<String, Double> factors = new ConcurrentHashMap<>();

    @Override
    public long estimate(String modelKey, List<Message> messages) {
        long raw = TokenBudget.estimateMessagesTokens(messages);
        return Math.round(raw * factor(modelKey));
    }

    @Override
    public double factor(String modelKey) {
        return factors.getOrDefault(key(modelKey), 1.0);
    }

    @Override
    public void calibrate(String modelKey, long realInput, long rawEstimateAtCall) {
        if (realInput <= 0 || rawEstimateAtCall <= 0) return;
        double obs = Math.max(MIN_F, Math.min(MAX_F, (double) realInput / rawEstimateAtCall));
        factors.merge(key(modelKey), obs, (old, o) -> old + ALPHA * (o - old));
    }

    private static String key(String m) { return m == null ? "?" : m; }
}
