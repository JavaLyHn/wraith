package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.automation.RequestInbox;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AppServer automations.runNow / automations.respondApproval RPC producer tests.
 *
 * <p>These two methods write RequestInbox files that the daemon's inbox poller consumes.
 * Tests verify: correct file written, correct type/id/payload, drain parseable.
 * Uses the wraith.automation.dir=@TempDir seam (same as AppServerAutomationsTest).
 */
class AppServerAutomationsControlPlaneTest {

    @TempDir
    Path tempDir;

    @AfterEach
    void clearProperty() {
        System.clearProperty("wraith.automation.dir");
    }

    /** Runs the AppServer with the given requests and returns all JSON-RPC replies. */
    private List<JsonNode> run(String... requests) throws Exception {
        System.setProperty("wraith.automation.dir", tempDir.toString());
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(
                new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id)
                .findFirst().orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    // -------------------------------------------------------------------------
    // Test 1: automations.runNow writes a run-now request drainable by RequestInbox
    // -------------------------------------------------------------------------
    @Test
    void runNow_writesRunNowRequestFile_drainableByRequestInbox() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runNow\","
                + "\"params\":{\"id\":\"task-42\"}}"
        );

        // RPC should return {ok:true}
        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "automations.runNow 应返回 result");
        assertTrue(result.path("ok").asBoolean(), "automations.runNow 应返回 {ok:true}");

        // RequestInbox should drain exactly one run-now request with the task id
        Path inboxDir = tempDir.resolve("automation-requests");
        RequestInbox inbox = new RequestInbox(inboxDir);
        List<RequestInbox.Request> drained = inbox.drain();
        assertEquals(1, drained.size(), "应有 1 条 run-now 请求文件");
        RequestInbox.Request req = drained.get(0);
        assertEquals("run-now", req.type(), "type 应为 run-now");
        assertEquals("task-42", req.id(), "id 应为 taskId");
        assertNull(req.payload(), "run-now payload 应为 null");
    }

    // -------------------------------------------------------------------------
    // Test 2: automations.runNow with missing id → -32602 error
    // -------------------------------------------------------------------------
    @Test
    void runNow_missingId_returnsError() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runNow\",\"params\":{}}"
        );
        JsonNode reply = byId(replies, 2);
        assertNull(reply.get("result"), "缺 id 不应返回 result");
        assertNotNull(reply.get("error"), "缺 id 应返回 error");
        assertEquals(-32602, reply.get("error").path("code").asInt());
    }

    // -------------------------------------------------------------------------
    // Test 3: automations.respondApproval writes an approval request drainable by RequestInbox
    // -------------------------------------------------------------------------
    @Test
    void respondApproval_writesApprovalRequestFile_drainableByRequestInbox() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\","
                + "\"params\":{\"runId\":\"run-1\",\"approvalId\":\"run-1#3\",\"decision\":\"approve\"}}"
        );

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "automations.respondApproval 应返回 result");
        assertTrue(result.path("ok").asBoolean(), "automations.respondApproval 应返回 {ok:true}");

        Path inboxDir = tempDir.resolve("automation-requests");
        RequestInbox inbox = new RequestInbox(inboxDir);
        List<RequestInbox.Request> drained = inbox.drain();
        assertEquals(1, drained.size(), "应有 1 条 approval 请求文件");
        RequestInbox.Request req = drained.get(0);
        assertEquals("approval", req.type(), "type 应为 approval");
        assertEquals("run-1#3", req.id(), "id 应为 approvalId");
        assertEquals("approve", req.payload(), "payload 应为 decision 值");
    }

    // -------------------------------------------------------------------------
    // Test 4: respondApproval with reject decision
    // -------------------------------------------------------------------------
    @Test
    void respondApproval_rejectDecision_writesRejectPayload() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\","
                + "\"params\":{\"approvalId\":\"run-5#2\",\"decision\":\"reject\"}}"
        );

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result);
        assertTrue(result.path("ok").asBoolean());

        RequestInbox inbox = new RequestInbox(tempDir.resolve("automation-requests"));
        List<RequestInbox.Request> drained = inbox.drain();
        assertEquals(1, drained.size());
        assertEquals("reject", drained.get(0).payload());
        assertEquals("run-5#2", drained.get(0).id());
    }

    // -------------------------------------------------------------------------
    // Test 5: respondApproval with missing approvalId → -32602 error
    // -------------------------------------------------------------------------
    @Test
    void respondApproval_missingApprovalId_returnsError() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\","
                + "\"params\":{\"decision\":\"approve\"}}"
        );
        JsonNode reply = byId(replies, 2);
        assertNull(reply.get("result"));
        assertNotNull(reply.get("error"));
        assertEquals(-32602, reply.get("error").path("code").asInt());
    }

    // -------------------------------------------------------------------------
    // Test 6: respondApproval with missing decision → -32602 error
    // -------------------------------------------------------------------------
    @Test
    void respondApproval_missingDecision_returnsError() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\","
                + "\"params\":{\"approvalId\":\"run-1#1\"}}"
        );
        JsonNode reply = byId(replies, 2);
        assertNull(reply.get("result"));
        assertNotNull(reply.get("error"));
        assertEquals(-32602, reply.get("error").path("code").asInt());
    }
}
