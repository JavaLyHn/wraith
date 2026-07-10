package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class WraithConfigFeishuTest {

    @Test
    void gatewayFeishuConfigRoundTripsThroughJackson() throws Exception {
        WraithConfig.GatewayFeishuConfig fs = new WraithConfig.GatewayFeishuConfig();
        fs.setAppId("cli_x");
        fs.setAppSecret("sec_x");
        fs.setOwnerOpenid("ou_owner");
        fs.setRegion("feishu");
        fs.setWorkspace("/tmp/ws");
        WraithConfig.GatewayConfig gw = new WraithConfig.GatewayConfig();
        gw.setFeishu(fs);

        ObjectMapper m = new ObjectMapper();
        String json = m.writeValueAsString(gw);
        WraithConfig.GatewayConfig back = m.readValue(json, WraithConfig.GatewayConfig.class);

        assertNotNull(back.getFeishu());
        assertEquals("cli_x", back.getFeishu().getAppId());
        assertEquals("sec_x", back.getFeishu().getAppSecret());
        assertEquals("ou_owner", back.getFeishu().getOwnerOpenid());
        assertEquals("feishu", back.getFeishu().getRegion());
        assertEquals("/tmp/ws", back.getFeishu().getWorkspace());
    }

    @Test
    void gatewayConfigWithoutFeishuHasNullFeishu() {
        assertNull(new WraithConfig.GatewayConfig().getFeishu());
    }
}
