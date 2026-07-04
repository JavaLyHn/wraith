package com.lyhn.wraith.automation;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;

class ScheduledRunRendererTest {

    /** Build a minimal ApprovalRequest for a given tool name. */
    private ApprovalRequest reqFor(String tool) {
        return ApprovalRequest.of(tool, "{}", "test reason");
    }

    private ScheduledRunRenderer renderer(ApprovalPolicy p, long timeoutMs,
                                          ScheduledRunRenderer.AskSurface s) {
        ScheduledRunRenderer r = new ScheduledRunRenderer(p, timeoutMs, s);
        r.setRunId("run1");
        return r;
    }

    @Test
    void denyRejectsImmediately() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.DENY;
        ScheduledRunRenderer r = renderer(p, 1000,
                (id, req) -> {
                    fail("AskSurface should not be called for DENY");
                    return null;
                });
        ApprovalResult result = r.promptApproval(reqFor("write_file"));
        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertTrue(r.deniedTools().contains("write_file"));
    }

    @Test
    void autoApproveApprovesImmediately() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.AUTO_APPROVE;
        ScheduledRunRenderer r = renderer(p, 1000,
                (id, req) -> {
                    fail("AskSurface should not be called for AUTO_APPROVE");
                    return null;
                });
        ApprovalResult result = r.promptApproval(reqFor("write_file"));
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
        assertTrue(r.deniedTools().isEmpty());
    }

    @Test
    void askResolvedApproves() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.ASK;
        ScheduledRunRenderer r = renderer(p, 2000,
                (id, req) -> CompletableFuture.completedFuture(ApprovalResult.approve()));
        ApprovalResult result = r.promptApproval(reqFor("write_file"));
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
    }

    @Test
    void askTimesOutRejects() {
        ApprovalPolicy p = new ApprovalPolicy();
        p.default_ = ApprovalMode.ASK;
        // Never-completing future — should time out in 150 ms
        ScheduledRunRenderer r = renderer(p, 150, (id, req) -> new CompletableFuture<>());
        ApprovalResult result = r.promptApproval(reqFor("write_file"));
        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertTrue(r.deniedTools().contains("write_file"),
                "timed-out ASK tool should be recorded in deniedTools");
    }
}
