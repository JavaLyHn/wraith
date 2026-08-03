package com.lyhn.wraith.config;

import java.util.Locale;

/**
 * provider 别名 → 规范名的<b>单一来源</b>。
 *
 * <p>这张表原先私有在 {@code LlmClientFactory.normalizeProvider}（:62-71）。抽出来的原因：
 * {@link ProviderResolver} 的端点护栏也要用它——{@code MOONSHOT_API_KEY} 发现出的候选是
 * {@code moonshot}，而端点白名单装的是规范名 {@code kimi}，不规范化就查会把它误挡下，
 * 尽管 {@code KimiClient.DEFAULT_BASE_URL}（{@code https://api.moonshot.ai/v1}）确实存在。
 *
 * <p>本次改动的主题就是「同一份 provider 名单别抄多份」，所以这里不复制一份别名表，
 * 而是让 {@code LlmClientFactory} 反过来委托这里。
 */
public final class ProviderNames {

    private ProviderNames() {}

    /**
     * 别名归一。表外的名字原样返回（小写、去空白）——新 provider 不需要登记就能用。
     * 入参为 null 时返回 null。
     */
    public static String normalize(String provider) {
        if (provider == null) {
            return null;
        }
        String normalized = provider.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "stepfun", "step-fun" -> "step";
            case "moonshot", "moonshotai", "moonshot-ai" -> "kimi";
            case "free-llm-api", "free_llm_api", "freellm", "free-llm" -> "freellmapi";
            case "xfyun-maas", "xfyun_maas", "iflytek", "iflytek-maas", "iflytek_maas", "maas" -> "xfyun";
            // claude 是 Anthropic 模型的通俗叫法,用户很自然会这么写(X1)。只登记真实存在的
            // 别名——拼写错误(anthropi/antropic/anthropics)不进这张表,那是无底洞,交给
            // /config 回显的端点警示兜底。
            case "claude", "anthropic-claude" -> "anthropic";
            default -> normalized;
        };
    }
}
