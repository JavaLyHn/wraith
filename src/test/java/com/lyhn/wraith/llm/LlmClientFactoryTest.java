package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

class LlmClientFactoryTest {

    @Test
    void createsGlm5vTurboClientWithMultimodalEndpoint() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("glm",
                new WraithConfig.ProviderConfig("test-glm-key", null, "glm-5v-turbo"));

        LlmClient client = LlmClientFactory.create("glm", config);

        GLMClient glmClient = assertInstanceOf(GLMClient.class, client);
        assertEquals("glm", glmClient.getProviderName());
        assertEquals("glm-5v-turbo", glmClient.getModelName());
        assertEquals("https://open.bigmodel.cn/api/paas/v4/chat/completions", glmClient.getApiUrl());
    }

    @Test
    void createsStepClientFromConfiguredProvider() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("step",
                new WraithConfig.ProviderConfig("test-step-key", null, "step-3.5-flash-2603"));

        LlmClient client = LlmClientFactory.create("step", config);

        StepClient stepClient = assertInstanceOf(StepClient.class, client);
        assertEquals("step", stepClient.getProviderName());
        assertEquals("step-3.5-flash-2603", stepClient.getModelName());
        assertEquals(256_000, stepClient.maxContextWindow());
        assertEquals(expectedStepChatUrl(config.getBaseUrl("step")), stepClient.getApiUrl());
    }

    @Test
    void createsStepClientFromStepfunAliasAndCustomBaseUrl() {
        WraithConfig config = new WraithConfig();
        config.setProviders(new LinkedHashMap<>());
        config.getProviders().put("step",
                new WraithConfig.ProviderConfig(
                        "test-step-key",
                        "https://api.stepfun.com/step_plan/v1",
                        "step-router-v1"));

        LlmClient client = LlmClientFactory.create("stepfun", config);

        StepClient stepClient = assertInstanceOf(StepClient.class, client);
        assertEquals("step-router-v1", stepClient.getModelName());
        assertEquals("https://api.stepfun.com/step_plan/v1/chat/completions", stepClient.getApiUrl());
    }

    @Test
    void createsKimiClientFromMoonshotAliasAndCustomBaseUrl() {
        WraithConfig config = new WraithConfig();
        config.setProviders(new LinkedHashMap<>());
        config.getProviders().put("kimi",
                new WraithConfig.ProviderConfig(
                        "test-kimi-key",
                        "https://api.moonshot.ai/v1",
                        "kimi-k2.6"));

        LlmClient client = LlmClientFactory.create("moonshot", config);

        KimiClient kimiClient = assertInstanceOf(KimiClient.class, client);
        assertEquals("kimi", kimiClient.getProviderName());
        assertEquals("kimi-k2.6", kimiClient.getModelName());
        assertEquals(256_000, kimiClient.maxContextWindow());
    }

    @Test
    void createsFreeLlmApiClientFromConfiguredProvider() {
        WraithConfig config = new WraithConfig();
        config.setProviders(new LinkedHashMap<>());
        config.getProviders().put("freellmapi",
                new WraithConfig.ProviderConfig(
                        "test-free-key",
                        "http://localhost:5173/v1",
                        "auto"));

        LlmClient client = LlmClientFactory.create("free-llm-api", config);

        FreeLlmApiClient freeClient = assertInstanceOf(FreeLlmApiClient.class, client);
        assertEquals("freellmapi", freeClient.getProviderName());
        assertEquals("auto", freeClient.getModelName());
        assertEquals("http://localhost:5173/v1/chat/completions", freeClient.getApiUrl());
        assertEquals(128_000, freeClient.maxContextWindow());
    }

    @Test
    void createsXfyunMaaSClientFromAliasAndConfiguredProvider() {
        WraithConfig config = new WraithConfig();
        config.setProviders(new LinkedHashMap<>());
        config.getProviders().put("xfyun",
                new WraithConfig.ProviderConfig(
                        "test-xfyun-key",
                        "https://maas-api.cn-huabei-1.xf-yun.com/v2",
                        "Qwen3.6-35B-A3B"));
        config.getProviders().get("xfyun").setLoraId("0");

        LlmClient client = LlmClientFactory.create("maas", config);

        XfyunMaaSClient xfyunClient = assertInstanceOf(XfyunMaaSClient.class, client);
        assertEquals("xfyun", xfyunClient.getProviderName());
        assertEquals("Qwen3.6-35B-A3B", xfyunClient.getModelName());
        assertEquals("https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions", xfyunClient.getApiUrl());
        assertEquals(128_000, xfyunClient.maxContextWindow());
        assertEquals(false, xfyunClient.supportsTools());
    }

    @Test
    void returnsNullForUnknownProviderWithoutKey() {
        WraithConfig config = new WraithConfig();
        // 未配置任何 provider(无 key)→ create 在 switch 前的 key 检查处返 null
        assertNull(LlmClientFactory.create("unknown", config));
    }

    private static String expectedStepChatUrl(String baseUrl) {
        String normalized = baseUrl != null && !baseUrl.isBlank()
                ? baseUrl.trim()
                : "https://api.stepfun.com/v1";
        String withoutTrailingSlash = normalized.replaceAll("/+$", "");
        if (withoutTrailingSlash.endsWith("/chat/completions")) {
            return withoutTrailingSlash;
        }
        return withoutTrailingSlash + "/chat/completions";
    }
}
