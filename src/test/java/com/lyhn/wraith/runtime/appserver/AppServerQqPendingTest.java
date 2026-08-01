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

    /** 等待某个 id 的回包出现在输出里(异步 dispatchAsync 用);0 = 不等。 */
    private static void awaitId(ByteArrayOutputStream out, int id) throws Exception {
        if (id <= 0) return;
        String needle = "\"id\":" + id;
        for (int i = 0; i < 100; i++) {
            if (out.toString(StandardCharsets.UTF_8).contains(needle)) return;
            Thread.sleep(50);
        }
    }

    private int awaitReplyId = 0;

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
        // dispatchAsync 的回包由后台线程写出,可能晚于 serve() 返回(shutdown 紧随其后)。
        // 直接读 out 会漏掉它 —— 轮询到目标 id 出现为止。
        awaitId(out, awaitReplyId);
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
        // daemon 没在跑 → 宽限期后由 app-server 兜底执行并清掉请求文件。
        // 旧断言(请求文件应残留、由 daemon 稍后消费)已被真机推翻:daemon 绝大多数时候
        // 不在运行,那个文件就永远躺着,界面点了「清空」毫无反应、队列纹丝不动。
        awaitReplyId = 2;
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{\"id\":\"some-id\"}}");
        JsonNode res = byId(replies, 2).path("result");
        assertTrue(res.path("ok").asBoolean());
        assertEquals("app-server", res.path("appliedBy").asText(), "无 daemon 时必须本进程兜底");
        Path reqDir = tempDir.resolve("automation-requests");
        if (Files.exists(reqDir)) {
            try (var s2 = Files.list(reqDir)) {
                assertEquals(0, s2.filter(p -> p.toString().endsWith(".json")).count(),
                        "兜底执行后不许留下请求文件,否则 daemon 起来会再执行一次");
            }
        }
    }

    @Test
    void qqPendingClearWithoutIdMeansClearResults() throws Exception {
        awaitReplyId = 2;
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{}}");
        JsonNode res = byId(replies, 2).path("result");
        assertTrue(res.path("ok").asBoolean());
        assertEquals("app-server", res.path("appliedBy").asText());
    }
}
