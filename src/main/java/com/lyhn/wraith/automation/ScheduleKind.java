package com.lyhn.wraith.automation;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ScheduleKind {
    INTERVAL("interval"), DAILY("daily"), WEEKLY("weekly"), CRON("cron");
    private final String wire;
    ScheduleKind(String w) { this.wire = w; }
    @JsonValue public String wire() { return wire; }
    @JsonCreator public static ScheduleKind of(String s) {
        for (ScheduleKind k : values()) if (k.wire.equals(s)) return k;
        // 兼容旧 UPPERCASE NAME（legacy 升级保护）
        for (ScheduleKind k : values()) if (k.name().equalsIgnoreCase(s)) return k;
        throw new IllegalArgumentException("Unknown ScheduleKind: " + s);
    }
}
