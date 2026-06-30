// src/test/java/com/lyhn/wraith/runtime/appserver/JsonRpcTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class JsonRpcTest {
    @Test
    void parsesRequestWithIdAndParams() {
        JsonRpc.Incoming m = JsonRpc.parse("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}");
        assertNotNull(m);
        assertEquals("turn.submit", m.method());
        assertFalse(m.isNotification());
        assertEquals("hi", m.params().get("input").asText());
    }

    @Test
    void parsesNotificationWithoutId() {
        JsonRpc.Incoming m = JsonRpc.parse("{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}");
        assertNotNull(m);
        assertTrue(m.isNotification());
    }

    @Test
    void malformedLineReturnsNull() {
        assertNull(JsonRpc.parse("not json"));
        assertNull(JsonRpc.parse("{\"jsonrpc\":\"2.0\"}")); // 无 method
    }

    @Test
    void writerEmitsSingleLineNotification() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new JsonRpcWriter(out).notify("turn.started", java.util.Map.of("turnId", "t1"));
        String s = out.toString(StandardCharsets.UTF_8);
        assertTrue(s.endsWith("\n"));
        assertEquals(1, s.chars().filter(c -> c == '\n').count());
        JsonNode n = JsonRpc.MAPPER.readTree(s);
        assertEquals("2.0", n.get("jsonrpc").asText());
        assertEquals("turn.started", n.get("method").asText());
        assertEquals("t1", n.get("params").get("turnId").asText());
        assertFalse(n.has("id"));
    }

    @Test
    void writerEmitsResultWithId() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new JsonRpcWriter(out).result(7, java.util.Map.of("sessionId", "s1"));
        JsonNode n = JsonRpc.MAPPER.readTree(out.toString(StandardCharsets.UTF_8));
        assertEquals(7, n.get("id").asInt());
        assertEquals("s1", n.get("result").get("sessionId").asText());
    }
}
