package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RedactKeyTest {
    @Test void redactsKeyWhenPresent() {
        String msg = "401 Unauthorized: Bearer sk-live-ABC123 rejected";
        assertEquals("401 Unauthorized: Bearer [redacted] rejected", Main.redactKey(msg, "sk-live-ABC123"));
    }
    @Test void leavesMessageUntouchedWhenKeyAbsent() {
        assertEquals("connection refused", Main.redactKey("connection refused", "sk-live-ABC123"));
    }
    @Test void nullSafe() {
        assertNull(Main.redactKey(null, "sk-x"));
        assertEquals("m", Main.redactKey("m", null));
        assertEquals("m", Main.redactKey("m", ""));
    }
}
