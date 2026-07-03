package com.lyhn.wraith.gateway.qq;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqEventsTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void parsesC2cMessage() throws Exception {
        // QQ C2C_MESSAGE_CREATE 的 d 负载(简化真实字段)
        JsonNode d = M.readTree("""
            {"id":"MSG123","content":"你好","timestamp":"2026-07-04T12:00:00+08:00",
             "author":{"user_openid":"OPENID_A"}}""");
        InboundMsg m = QqEvents.parseC2C(d);
        assertEquals("OPENID_A", m.openid());
        assertEquals("你好", m.text());
        assertEquals("MSG123", m.msgId());
    }

    @Test void parsesInteraction() throws Exception {
        JsonNode d = M.readTree("""
            {"id":"INT1","chat_type":1,"user_openid":"OPENID_A",
             "data":{"resolved":{"button_data":"approve:sess-1:allow-once"}}}""");
        QqEvents.Interaction it = QqEvents.parseInteraction(d);
        assertEquals("INT1", it.id());
        assertEquals("approve:sess-1:allow-once", it.buttonData());
    }

    @Test void dedupCatchesRepeat() {
        Dedup d = new Dedup(1000);
        assertFalse(d.seen("m1"));
        assertTrue(d.seen("m1"));
        assertFalse(d.seen("m2"));
    }
}
