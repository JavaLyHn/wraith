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
