package com.lyhn.wraith.context;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.util.AnsiStyle;

import java.util.Locale;

public final class TokenUsageFormatter {
    private TokenUsageFormatter() {
    }

    public static String format(LlmClient llmClient, PricingTable pricingTable, int inputTokens, int outputTokens,
                                int cachedInputTokens, long startNanos) {
        ContextProfile profile = ContextProfile.from(llmClient);
        double elapsedSeconds = (System.nanoTime() - startNanos) / 1_000_000_000.0;
        int total = Math.max(0, inputTokens) + Math.max(0, outputTokens);
        String cost = estimatedCost(llmClient, pricingTable, inputTokens, outputTokens, cachedInputTokens);
        // 未知模型/无 PricingTable 时 cost 为 null——省略"估算 X"片段,不拿假数字糊弄用户。
        String cachedPart = cost == null
                ? String.format(Locale.ROOT, "cached: %d", Math.max(0, cachedInputTokens))
                : String.format(Locale.ROOT, "cached: %d, 估算 %s", Math.max(0, cachedInputTokens), cost);
        // 第 16 期：Y 显示 maxContextWindow（即模型窗口本身），不再用 80% × window 这种"软预算"
        // 误导用户。AgentBudget 默认已无硬限，撞窗口由 ConversationHistoryCompactor 自动压缩兜底。
        return AnsiStyle.subtle(String.format(Locale.ROOT,
                "📊 Token: 已用 %d / %d (%s) | 输入 %d / 输出 %d | ⏱ %.1fs",
                total,
                profile.maxContextWindow(),
                cachedPart,
                Math.max(0, inputTokens),
                Math.max(0, outputTokens),
                elapsedSeconds));
    }

    /** 成本估算:未知模型返回 null(宁缺勿虚)。table 由调用方持有(config 生命周期)。 */
    public static String estimatedCost(LlmClient llmClient, PricingTable table,
                                       int inputTokens, int outputTokens, int cachedInputTokens) {
        if (llmClient == null || table == null) return null;
        return table.formatCost(llmClient.getModelName(), inputTokens, outputTokens, cachedInputTokens)
                .orElse(null);
    }
}
