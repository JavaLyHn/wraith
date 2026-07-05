package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ProviderConfigLabelTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void labelRoundTrips() throws Exception {
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setLabel("工作号");
        String json = MAPPER.writeValueAsString(pc);
        WraithConfig.ProviderConfig back = MAPPER.readValue(json, WraithConfig.ProviderConfig.class);
        assertEquals("工作号", back.getLabel());
    }

    @Test
    void oldConfigWithoutLabelDeserializesToNull() throws Exception {
        // 旧文件:只有 apiKey/model,没有 label
        String legacy = "{\"apiKey\":\"k\",\"model\":\"m\",\"baseUrl\":\"u\"}";
        WraithConfig.ProviderConfig back = MAPPER.readValue(legacy, WraithConfig.ProviderConfig.class);
        assertNull(back.getLabel(), "旧文件无 label → null");
        assertEquals("k", back.getApiKey());
    }
}
