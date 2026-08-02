package com.lyhn.wraith.cli;

import com.lyhn.wraith.policy.sandbox.SandboxKind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class MainInitializeResultTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> caps(Map<String, Object> res) {
        return (Map<String, Object>) res.get("capabilities");
    }

    @Test
    void sandboxAvailableReportsSeatbelt() {
        Map<String, Object> res = Main.buildInitializeResult("deepseek", SandboxKind.SEATBELT);
        assertEquals("macos-seatbelt", caps(res).get("sandbox"));
        assertEquals("deepseek", res.get("model"));
    }

    @Test
    void sandboxUnavailableReportsNone() {
        Map<String, Object> res = Main.buildInitializeResult("m", SandboxKind.NONE);
        assertEquals("none", caps(res).get("sandbox"));
    }

    @Test
    @DisplayName("Windows 报 windows-appcontainer —— 前端据此显示,不再靠 platform 反推")
    void appContainerReportsItsOwnKind() {
        Map<String, Object> res = Main.buildInitializeResult("m", SandboxKind.APPCONTAINER);
        assertEquals("windows-appcontainer", caps(res).get("sandbox"));
    }

    @Test
    @DisplayName("kind 为 null 时保守报 none,不抛")
    void nullKindDegradesToNone() {
        Map<String, Object> res = Main.buildInitializeResult("m", null);
        assertEquals("none", caps(res).get("sandbox"));
    }

    @Test
    void nullModelBecomesEmptyString() {
        Map<String, Object> res = Main.buildInitializeResult(null, SandboxKind.SEATBELT);
        assertEquals("", res.get("model"));
    }
}
