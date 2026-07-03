package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WraithConfigGatewayTest {
    @Test
    void deserializesGatewayQqSection() throws Exception {
        String json = """
            {"defaultProvider":"glm","providers":{},
             "gateway":{"qq":{"appId":"A","clientSecret":"S","ownerOpenid":"O","workspace":"/w"}}}""";
        WraithConfig c = new ObjectMapper().readValue(json, WraithConfig.class);
        assertNotNull(c.getGateway());
        assertNotNull(c.getGateway().getQq());
        assertEquals("A", c.getGateway().getQq().getAppId());
        assertEquals("O", c.getGateway().getQq().getOwnerOpenid());
        assertEquals("/w", c.getGateway().getQq().getWorkspace());
    }

    @Test
    void missingGatewaySectionIsNull() throws Exception {
        WraithConfig c = new ObjectMapper().readValue("{\"providers\":{}}", WraithConfig.class);
        assertNull(c.getGateway());
    }
}
