package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LlmClientFactoryRoutingTest {
    private WraithConfig cfgWith(String id, String protocol, String baseUrl) {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setApiKey("sk-test"); pc.setModel("m"); pc.setBaseUrl(baseUrl);
        if (protocol != null) pc.setProtocol(protocol);
        cfg.getProviders().put(id, pc);
        return cfg;
    }

    @Test void bespokeProvidersStillReturnTheirClient() {
        assertTrue(LlmClientFactory.create("deepseek", cfgWith("deepseek", null, null)) instanceof DeepSeekClient);
        assertTrue(LlmClientFactory.create("glm", cfgWith("glm", null, null)) instanceof GLMClient);
    }
    @Test void newOpenaiProviderRoutesToGeneric() {
        LlmClient c = LlmClientFactory.create("openrouter", cfgWith("openrouter", "openai", "https://openrouter.ai/api/v1"));
        assertTrue(c instanceof GenericOpenAiClient);
        assertEquals("openrouter", c.getProviderName());
    }
    @Test void anthropicProviderRoutesToAnthropicClient() {
        LlmClient c = LlmClientFactory.create("anthropic", cfgWith("anthropic", "anthropic", "https://api.anthropic.com"));
        assertTrue(c instanceof AnthropicClient);
    }
    @Test void openhanakoAliasStillBridgesToBespoke() {
        // moonshot→kimi(normalizeProvider),仍走 bespoke KimiClient
        assertTrue(LlmClientFactory.create("moonshot", cfgWith("moonshot", null, null)) instanceof KimiClient);
    }
    @Test void unknownProviderWithoutKeyReturnsNull() {
        assertNull(LlmClientFactory.create("openai", new WraithConfig()));
    }

    @Test
    @org.junit.jupiter.api.DisplayName("env-only anthropic(无 config 条目、无 protocol)必须造出 AnthropicClient,不能落进 GenericOpenAiClient")
    void envOnlyAnthropicDoesNotLeakToOpenAi() {
        // 回归防线(C1):WraithConfig.getProtocol 在没有 config 条目时返回 "openai",
        // 而 GenericOpenAiClient 在 baseUrl 为空时兜底 https://api.openai.com/v1 ——
        // 曾导致用户的 Anthropic key 被以 Bearer 发给 OpenAI。这里故意不 setProtocol,
        // 复现 CLI(此前无 --protocol 选项)/ env-only 的真实路径。
        WraithConfig c = new WraithConfig();
        c.setProviders(new java.util.LinkedHashMap<>());
        c.getProviders().put("anthropic",
                new WraithConfig.ProviderConfig("sk-ant-test", null, "claude-haiku-4-5"));

        LlmClient client = LlmClientFactory.create("anthropic", c);

        assertTrue(client instanceof AnthropicClient,
                "落进 " + (client == null ? "null" : client.getClass().getSimpleName())
                        + " 会把 Anthropic key 发给 api.openai.com");
    }
}
