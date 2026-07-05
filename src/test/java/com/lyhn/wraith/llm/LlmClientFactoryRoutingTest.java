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
}
