package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class MainInitializeResultTest {
    @Test
    void sandboxAvailableReportsSeatbelt() {
        Map<String, Object> res = Main.buildInitializeResult("deepseek", true);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) res.get("capabilities");
        assertEquals("macos-seatbelt", caps.get("sandbox"));
        assertEquals("deepseek", res.get("model"));
    }

    @Test
    void sandboxUnavailableReportsNone() {
        Map<String, Object> res = Main.buildInitializeResult("m", false);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) res.get("capabilities");
        assertEquals("none", caps.get("sandbox"));
    }

    @Test
    void nullModelBecomesEmptyString() {
        java.util.Map<String, Object> res = Main.buildInitializeResult(null, true);
        assertEquals("", res.get("model"));
    }
}
