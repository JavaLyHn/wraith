// src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamApprovalTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class EventStreamApprovalTest {
    @Test
    void promptApprovalBlocksThenResolves() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "s1");
        r.setCurrentTurnId("t1");
        ApprovalRequest req = ApprovalRequest.of("execute_command", "{\"command\":\"rm x\"}", null, null, null);

        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));

        // 等通知出现，取出 approvalId
        String approvalId = null;
        for (int i = 0; i < 50 && approvalId == null; i++) {
            for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
                if (ln.isBlank()) continue;
                JsonNode n = JsonRpc.MAPPER.readTree(ln);
                if ("approval.requested".equals(n.path("method").asText())) {
                    approvalId = n.get("params").get("approvalId").asText();
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId, "应发出 approval.requested 并带 approvalId");
        assertFalse(f.isDone(), "未回应前应阻塞");

        r.resolveApproval(approvalId, new ApprovalResult(ApprovalResult.Decision.APPROVED, null, null));
        ApprovalResult result = f.get(2, TimeUnit.SECONDS);
        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
        ex.shutdownNow();
    }

    @Test
    void approvalRequestedCarriesBeforeContent() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "s1");
        r.setCurrentTurnId("t1");
        ApprovalRequest req = ApprovalRequest
                .of("write_file", "{\"path\":\"a.txt\",\"content\":\"new\"}", null, null, null)
                .withBeforeContent("old body");

        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));
        String beforeContent = null;
        for (int i = 0; i < 50 && beforeContent == null; i++) {
            for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
                if (ln.isBlank()) continue;
                JsonNode n = JsonRpc.MAPPER.readTree(ln);
                if ("approval.requested".equals(n.path("method").asText())) {
                    beforeContent = n.get("params").path("beforeContent").asText(null);
                    r.resolveApproval(n.get("params").get("approvalId").asText(), ApprovalResult.approve());
                }
            }
            if (beforeContent == null) Thread.sleep(20);
        }
        f.get(2, TimeUnit.SECONDS);
        assertEquals("old body", beforeContent);
        ex.shutdownNow();
    }
}
