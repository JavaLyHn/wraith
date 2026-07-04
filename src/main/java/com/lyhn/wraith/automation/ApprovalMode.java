package com.lyhn.wraith.automation;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ApprovalMode {
    DENY("deny"), AUTO_APPROVE("auto-approve"), ASK("ask");
    private final String wire;
    ApprovalMode(String w) { this.wire = w; }
    @JsonValue public String wire() { return wire; }
    @JsonCreator public static ApprovalMode of(String s) {
        for (ApprovalMode m : values()) if (m.wire.equals(s)) return m;
        return DENY;   // 未知 → 最安全
    }
}
