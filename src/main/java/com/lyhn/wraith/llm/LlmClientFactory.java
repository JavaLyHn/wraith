package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.ProviderResolver;
import com.lyhn.wraith.config.WraithConfig;

public class LlmClientFactory {

    private LlmClientFactory() {}

    public static LlmClient create(String provider, WraithConfig config) {
        if (provider == null) return null;

        String normalized = normalizeProvider(provider);
        String configuredProvider = provider.trim().toLowerCase();
        String apiKey = config.getApiKey(normalized);
        if ((apiKey == null || apiKey.isBlank()) && !configuredProvider.equals(normalized)) {
            apiKey = config.getApiKey(configuredProvider);
        }
        if (apiKey == null || apiKey.isBlank()) {
            return null;
        }

        String model = firstConfigured(config.getModel(normalized),
                configuredProvider.equals(normalized) ? null : config.getModel(configuredProvider));
        String baseUrl = firstConfigured(config.getBaseUrl(normalized),
                configuredProvider.equals(normalized) ? null : config.getBaseUrl(configuredProvider));
        String loraId = firstConfigured(config.getLoraId(normalized),
                configuredProvider.equals(normalized) ? null : config.getLoraId(configuredProvider));

        return switch (normalized) {
            case "glm" -> new GLMClient(apiKey, model);
            case "deepseek" -> new DeepSeekClient(apiKey, model);
            case "step" -> new StepClient(apiKey, model, baseUrl);
            case "kimi" -> new KimiClient(apiKey, model, baseUrl);
            case "freellmapi" -> new FreeLlmApiClient(apiKey, model, baseUrl);
            case "xfyun" -> new XfyunMaaSClient(apiKey, model, baseUrl, loraId);
            // anthropic 必须在这里显式派发,不能靠 default 分支的 protocol 判断:
            // WraithConfig.getProtocol 在没有 config 条目时返回 "openai",于是 env-only
            // 或 CLI 配置(CLI 无 --protocol 时)的 anthropic 会落进 GenericOpenAiClient,
            // 而后者 baseUrl 空时兜底 api.openai.com —— 用户的 Anthropic key 会被发给 OpenAI。
            // anthropic 必须在这里显式派发,不能靠 default 分支的 protocol 判断:
            // WraithConfig.getProtocol 在没有 config 条目时返回 "openai",于是 env-only
            // 或 CLI 配置(CLI 无 --protocol 时)的 anthropic 会落进 GenericOpenAiClient,
            // 而后者 baseUrl 空时兜底 api.openai.com —— 用户的 Anthropic key 会被发给 OpenAI。
            case "anthropic" -> new AnthropicClient(apiKey, model, baseUrl);
            default -> {
                String protocol = config.getProtocol(configuredProvider);
                if ("anthropic".equalsIgnoreCase(protocol)) {
                    yield new AnthropicClient(apiKey, model, baseUrl);
                }
                yield new GenericOpenAiClient(apiKey, model, baseUrl, configuredProvider);
            }
        };
    }

    /**
     * 按 {@link ProviderResolver} 的候选顺序装载第一个能用的 client；一个都不行返回 null。
     *
     * <p><b>此前这里是一个硬编码数组</b> {@code {glm,deepseek,step,kimi,freellmapi,xfyun}}，
     * 于是只配了 anthropic / openai / siliconflow（乃至 freellmapi-2 这种多实例 id）的用户
     * 拿不到 client——桌面里明明配好了，界面却说「无可用模型」。
     * 现在的规则与 {@code Main.configRemoveProvider} 一致：谁有 key 谁就是候选。
     */
    public static LlmClient createFromConfig(WraithConfig config) {
        return createFrom(config, ProviderResolver.candidates(config));
    }

    /**
     * 同上，但候选表由调用方给出。
     *
     * <p>存在的唯一理由是<b>测试确定性</b>：{@link ProviderResolver#candidates(WraithConfig)}
     * 会扫真实环境变量，若测试走 public 入口，「什么都没配应返回 null」这类断言就会在设了
     * {@code ANTHROPIC_API_KEY} 的开发机上失败、在干净 CI 上通过。
     */
    static LlmClient createFrom(WraithConfig config, java.util.List<String> candidates) {
        if (candidates == null) {
            return null;
        }
        for (String provider : candidates) {
            LlmClient client = create(provider, config);
            if (client != null) {
                return client;
            }
        }
        return null;
    }

    /** 委托 {@link com.lyhn.wraith.config.ProviderNames}——别名表只存一份。 */
    private static String normalizeProvider(String provider) {
        return com.lyhn.wraith.config.ProviderNames.normalize(provider);
    }

    private static String firstConfigured(String primary, String fallback) {
        if (primary != null && !primary.isBlank()) {
            return primary;
        }
        return fallback;
    }
}
