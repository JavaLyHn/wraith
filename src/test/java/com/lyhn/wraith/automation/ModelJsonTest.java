package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ModelJsonTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void taskRoundTrips() throws Exception {
        AutomationTask t = new AutomationTask();
        t.id = "t1"; t.name = "日报"; t.prompt = "跑日报"; t.workspace = "/w";
        t.schedule = new Schedule(); t.schedule.kind = ScheduleKind.CRON; t.schedule.expr = "0 9 * * 1-5";
        t.enabled = true;
        DeliveryTarget qq = new DeliveryTarget(); qq.platform = "qq";
        t.deliverTo = List.of(qq);
        t.approval = new ApprovalPolicy();
        t.approval.default_ = ApprovalMode.ASK;
        t.approval.tools = Map.of("run_shell", ApprovalMode.DENY);
        t.createdAt = 1L; t.enabledAt = 1L;

        String json = M.writeValueAsString(t);
        assertTrue(json.contains("\"kind\":\"cron\""));
        assertTrue(json.contains("\"default\":\"ask\""), json);       // ApprovalMode @JsonValue
        AutomationTask back = M.readValue(json, AutomationTask.class);
        assertEquals(ScheduleKind.CRON, back.schedule.kind);
        assertEquals("0 9 * * 1-5", back.schedule.expr);
        assertEquals("qq", back.deliverTo.get(0).platform);
    }

    // 桌面 TS AutomationTask 是线格式的超集:额外携带 projectPath(旧别名,已被 workspace 取代)
    // 与 lastFiredAt(运行态,归 daemon 的 automation-state.json)。Java 侧须容忍并丢弃这些
    // TS-only 字段,否则 automations.upsert 反序列化必失败(与 ScheduleKind 同类的跨层 gap)。
    @Test void taskFromDesktopIgnoresTsOnlyFields() throws Exception {
        String desktopJson = """
            {"id":"t1","name":"日报","prompt":"p","projectPath":"/proj","workspace":"/proj",
             "schedule":{"kind":"interval","everyMinutes":10},
             "enabled":true,"createdAt":1,"enabledAt":1,"lastFiredAt":null,
             "deliverTo":[{"platform":"qq"}],"approval":{"default":"deny"}}
            """;
        AutomationTask back = M.readValue(desktopJson, AutomationTask.class);   // 不得抛未知字段异常
        assertEquals("t1", back.id);
        assertEquals("/proj", back.workspace);                                  // workspace 为规范字段
        assertEquals(ScheduleKind.INTERVAL, back.schedule.kind);
        assertEquals(10, back.schedule.everyMinutes);
    }

    @Test void approvalResolvePerToolThenDefault() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.ASK;
        p.tools = Map.of("run_shell", ApprovalMode.DENY, "read_file", ApprovalMode.AUTO_APPROVE);
        assertEquals(ApprovalMode.DENY, p.resolve("run_shell"));
        assertEquals(ApprovalMode.AUTO_APPROVE, p.resolve("read_file"));
        assertEquals(ApprovalMode.ASK, p.resolve("write_file"));       // 未列 → default
    }

    @Test void approvalDefaultsToDenyWhenNull() {
        ApprovalPolicy p = new ApprovalPolicy();     // default_ 未设
        assertEquals(ApprovalMode.DENY, p.resolve("anything"));
        assertEquals(30, p.askTimeoutMinutesOr(30));
    }
}
