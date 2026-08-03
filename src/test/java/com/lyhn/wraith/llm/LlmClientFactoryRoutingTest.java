package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
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

    @Test
    @DisplayName("provider 名 anthropic/claude + 显式 protocol=openai(中转站)→ 必须走 GenericOpenAiClient")
    void explicitOpenAiProtocolIsHonoredForAnthropicNamedProvider() {
        // 用户全用中转站:protocol=openai + 自定义 baseUrl。若这里派发成 AnthropicClient,
        // 会用 Anthropic 报文去请求只认 OpenAI 协议的中转站,直接不通。
        // 改动前这条配置是能用的(走 default 分支),所以这是回归防线。
        for (String id : java.util.List.of("anthropic", "claude")) {
            WraithConfig c = new WraithConfig();
            c.setProviders(new java.util.LinkedHashMap<>());
            WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig(
                    "sk-relay-test", "https://relay.example/v1", "claude-sonnet-4-5");
            pc.setProtocol("openai");
            c.getProviders().put(id, pc);

            assertInstanceOf(GenericOpenAiClient.class, LlmClientFactory.create(id, c),
                    id + " 显式 protocol=openai 必须被尊重");
        }
    }

    @Test
    @DisplayName("未设 protocol → AnthropicClient(保住 X1:否则 key 会被发给 api.openai.com)")
    void unsetProtocolStillGivesAnthropicClient() {
        for (String id : java.util.List.of("anthropic", "claude")) {
            WraithConfig c = new WraithConfig();
            c.setProviders(new java.util.LinkedHashMap<>());
            // 刻意不 setProtocol —— 复现 env-only 与 CLI 无 --protocol 的路径
            c.getProviders().put(id, new WraithConfig.ProviderConfig(
                    "sk-ant-test", null, "claude-haiku-4-5"));

            assertInstanceOf(AnthropicClient.class, LlmClientFactory.create(id, c), id);
        }
    }

    @Test
    @DisplayName("显式 protocol=anthropic → AnthropicClient")
    void explicitAnthropicProtocolGivesAnthropicClient() {
        WraithConfig c = new WraithConfig();
        c.setProviders(new java.util.LinkedHashMap<>());
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig(
                "sk-ant-test", "https://api.anthropic.com", "claude-haiku-4-5");
        pc.setProtocol("anthropic");
        c.getProviders().put("anthropic", pc);

        assertInstanceOf(AnthropicClient.class, LlmClientFactory.create("anthropic", c));
    }
}
