package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class MainInitializeResultTest {

    @Test
    void carriesModelAndCapabilities() {
        Map<String, Object> r = Main.buildInitializeResult("deepseek-chat");
        assertEquals("wraith-app-server", r.get("serverInfo"));
        assertEquals("deepseek-chat", r.get("model"));
        assertTrue(r.get("capabilities") instanceof Map);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) r.get("capabilities");
        assertEquals(Boolean.TRUE, caps.get("toolOutputStreaming"));
        assertEquals(Boolean.TRUE, caps.get("approvals"));
    }

    @Test
    void nullModelBecomesEmptyString() {
        assertEquals("", Main.buildInitializeResult(null).get("model"));
    }
}
