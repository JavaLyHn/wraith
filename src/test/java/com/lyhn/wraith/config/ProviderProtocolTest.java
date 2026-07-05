package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProviderProtocolTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void protocolRoundTripsAndDefaultsToOpenai() throws Exception {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setApiKey("k"); pc.setProtocol("anthropic");
        cfg.getProviders().put("anthropic", pc);
        String json = M.writeValueAsString(cfg);
        WraithConfig back = M.readValue(json, WraithConfig.class);
        assertEquals("anthropic", back.getProviders().get("anthropic").getProtocol());
        assertEquals("anthropic", back.getProtocol("anthropic"));
        assertEquals("openai", back.getProtocol("nonexistent"));   // 缺省 openai
    }

    @Test void legacyEntryWithoutProtocolReadsAsOpenai() throws Exception {
        // 旧 config(无 protocol 字段)
        String legacy = "{\"defaultProvider\":\"deepseek\",\"providers\":{\"deepseek\":{\"apiKey\":\"k\",\"model\":\"m\"}}}";
        WraithConfig cfg = M.readValue(legacy, WraithConfig.class);
        assertNull(cfg.getProviders().get("deepseek").getProtocol());
        assertEquals("openai", cfg.getProtocol("deepseek"));
    }
}
