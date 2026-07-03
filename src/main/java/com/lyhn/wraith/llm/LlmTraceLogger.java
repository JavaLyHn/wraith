package com.lyhn.wraith.llm;

import org.slf4j.Logger;

import java.util.regex.Pattern;

/**
 * Diagnostic logging for model-side traces that are otherwise only streamed to
 * the terminal. Keep this focused on model text; request bodies may contain
 * large base64 images and should not be logged here.
 */
public final class LlmTraceLogger {
    private LlmTraceLogger() {}

    /**
     * base64 值的最小截断长度:不足此长度则认为不是真实 base64 载荷,原样保留。
     */
    private static final int BASE64_TRUNCATE_THRESHOLD = 128;

    /**
     * 匹配 JSON 中 imageBase64 字段的长 base64 串(双引号包裹,至少 128 字符)。
     * 替换为前 64 字符 + …[truncated]。
     */
    private static final Pattern BASE64_PATTERN =
            Pattern.compile("(\"imageBase64\"\\s*:\\s*\")([A-Za-z0-9+/=]{" + BASE64_TRUNCATE_THRESHOLD + ",})(\")",
                    Pattern.DOTALL);

    /**
     * 对请求体 JSON 字符串中 {@code imageBase64} 字段的 base64 值做安全截断:
     * 保留前 64 字符并追加 {@code …[truncated]},避免大 base64 载荷污染日志。
     *
     * @param json 原始请求体 JSON 字符串
     * @return 截断后的字符串;若无 base64 字段则原样返回
     */
    public static String truncateBase64InJson(String json) {
        if (json == null || json.isBlank()) {
            return json;
        }
        return BASE64_PATTERN.matcher(json).replaceAll(m ->
                m.group(1) + m.group(2).substring(0, 64) + "…[truncated]" + m.group(3));
    }

    public static void logReasoning(Logger log, String scope, LlmClient llmClient, String reasoningContent) {
        if (log == null || reasoningContent == null || reasoningContent.isBlank()) {
            return;
        }
        String normalized = reasoningContent.replace("\r\n", "\n").replace('\r', '\n').trim();
        log.info("LLM reasoning [{}] provider={} model={} chars={}\n{}",
                scope == null || scope.isBlank() ? "unknown" : scope,
                llmClient == null ? "unknown" : llmClient.getProviderName(),
                llmClient == null ? "unknown" : llmClient.getModelName(),
                normalized.length(),
                normalized);
    }
}
