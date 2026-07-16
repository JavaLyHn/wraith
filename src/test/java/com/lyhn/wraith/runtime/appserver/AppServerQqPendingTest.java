package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** automations.qqPending / qqPendingClear RPC 测试;harness 复制自 AppServerAutomationsTest。 */
class AppServerQqPendingTest {

    @TempDir Path tempDir;

    @AfterEach
    void clearProperty() { System.clearProperty("wraith.automation.dir"); }

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

    @Test
    void qqPendingReturnsSnapshotWithPreview() throws Exception {
        QqPendingStore store = new QqPendingStore(tempDir);
        QqPendingStore.Pending r = new QqPendingStore.Pending();
        r.taskName = "daily"; r.answer = "a".repeat(130); r.ts = 1000L;
        store.enqueue(r);
        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "deploy"; ap.answer = "需要审批"; ap.ts = 2000L; ap.approvalId = "ap-1";
        store.enqueue(ap);

        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPending\",\"params\":{}}");
        JsonNode result = byId(replies, 2).path("result");
        assertEquals(2, result.path("count").asInt());
        JsonNode items = result.path("items");
        // 快照顺序 = 入队顺序(排序是渲染层职责,见 Task 5 sortQqPending)
        JsonNode first = items.get(0);
        assertEquals("result", first.path("kind").asText());
        String preview = first.path("answerPreview").asText();
        assertEquals(121, preview.length());
        assertTrue(preview.endsWith("…"));
        assertFalse(first.path("id").asText().isBlank());
        assertEquals(1000L, first.path("ts").asLong());
        JsonNode second = items.get(1);
        assertEquals("approval", second.path("kind").asText());
        assertEquals("ap-1", second.path("approvalId").asText());
    }

    @Test
    void qqPendingEmptyWhenNoFile() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPending\",\"params\":{}}");
        JsonNode result = byId(replies, 2).path("result");
        assertEquals(0, result.path("count").asInt());
        assertTrue(result.path("items").isArray());
        assertEquals(0, result.path("items").size());
    }

    @Test
    void qqPendingClearWritesInboxRequest() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{\"id\":\"some-id\"}}");
        assertTrue(byId(replies, 2).path("result").path("ok").asBoolean());
        Path reqDir = tempDir.resolve("automation-requests");
        List<Path> files;
        try (var s = Files.list(reqDir)) { files = s.filter(p -> p.toString().endsWith(".json")).toList(); }
        assertEquals(1, files.size());
        JsonNode req = JsonRpc.MAPPER.readTree(Files.readAllBytes(files.get(0)));
        assertEquals("qq-pending-clear", req.path("type").asText());
        assertEquals("some-id", req.path("id").asText());
        assertTrue(req.path("payload").isNull());
    }

    @Test
    void qqPendingClearWithoutIdMeansClearResults() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{}}");
        assertTrue(byId(replies, 2).path("result").path("ok").asBoolean());
        Path reqDir = tempDir.resolve("automation-requests");
        List<Path> files;
        try (var s = Files.list(reqDir)) { files = s.filter(p -> p.toString().endsWith(".json")).toList(); }
        assertEquals(1, files.size());
        JsonNode req = JsonRpc.MAPPER.readTree(Files.readAllBytes(files.get(0)));
        assertEquals("qq-pending-clear", req.path("type").asText());
        assertTrue(req.path("id").isNull());
    }
}
