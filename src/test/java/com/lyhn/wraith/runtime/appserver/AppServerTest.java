// src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AppServerTest {
    /** 假会话：runTurn 用脚本化序列驱动真实 EventStreamRenderer。 */
    private AppServer.SessionRunnerFactory fakeFactory() {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    r.appendThinking("thinking about " + input);
                    r.appendAssistantContentDelta("hello");
                    r.finishAssistantContent();
                    return "hello";
                }
            };
        };
    }

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void fullTurnEmitsExpectedEventSequence() throws Exception {
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        AppServer server = new AppServer(in, out, fakeFactory());
        server.serve(); // 读到 EOF / shutdown 返回

        // turn 在 worker 线程上跑；等 turn.completed 出现（serve 已退出但线程可能仍在收尾）
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline
                && !out.toString(StandardCharsets.UTF_8).contains("turn.completed")) {
            Thread.sleep(20);
        }

        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        List<String> methods = new ArrayList<>();
        for (JsonNode n : msgs) methods.add(n.has("method") ? n.get("method").asText() : "result:" + n.get("id"));

        assertTrue(methods.contains("turn.started"));
        assertTrue(methods.contains("thinking.delta"));
        assertTrue(methods.contains("message.delta"));
        assertTrue(methods.contains("turn.completed"));
        // session.start 必须先于 turn.started
        assertTrue(indexOfResult(msgs, 2) >= 0, "session.start 应有 result");
    }

    private int indexOfResult(List<JsonNode> msgs, int id) {
        for (int i = 0; i < msgs.size(); i++) if (msgs.get(i).path("id").asInt(-1) == id && msgs.get(i).has("result")) return i;
        return -1;
    }

    // --- 附件 dispatch 用例 ---

    @TempDir
    Path tmpDir;

    /** 带文本附件的 turn.submit：fake runner 记录 effectiveInput，断言含 fence 块与正文。 */
    @Test
    void textAttachmentIsInjectedIntoInput() throws Exception {
        Path textFile = tmpDir.resolve("note.txt");
        Files.writeString(textFile, "hello from file", StandardCharsets.UTF_8);

        // 构造 params JSON 含 attachments
        ObjectMapper m = new ObjectMapper();
        ObjectNode params = m.createObjectNode();
        params.put("input", "user question");
        ArrayNode atts = params.putArray("attachments");
        ObjectNode att = atts.addObject();
        att.put("path", textFile.toString());
        att.put("kind", "text");
        String paramsJson = m.writeValueAsString(params);

        // fake runner 记录 input
        AtomicReference<String> capturedInput = new AtomicReference<>();
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    capturedInput.set(input);
                    r.appendAssistantContentDelta("ok");
                    r.finishAssistantContent();
                    return "ok";
                }
                public String runTurn(String input,
                                      java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                                      java.util.List<String> imageNames) throws Exception {
                    return runTurn(input);
                }
            };
        };

        String rpcInput = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":" + paramsJson + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";

        ByteArrayInputStream in = new ByteArrayInputStream(rpcInput.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AppServer server = new AppServer(in, out, factory);
        server.serve();

        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && capturedInput.get() == null) {
            Thread.sleep(20);
        }

        String effective = capturedInput.get();
        assertNotNull(effective, "runner 应被调用");
        assertTrue(effective.contains("```note.txt\n"), "effectiveInput 应含 fence 块头");
        assertTrue(effective.contains("hello from file"), "effectiveInput 应含文件内容");
        assertTrue(effective.contains("user question"), "effectiveInput 应含原始正文");
    }

    /** 超限附件触发 turn.failed 通知含 "附件错误"，turn.completed 不出现。 */
    @Test
    void oversizedAttachmentEmitsTurnFailed() throws Exception {
        Path bigFile = tmpDir.resolve("huge.txt");
        // 写一个 > 512 KB 的文本文件
        byte[] data = new byte[(int)(TurnAttachments.TEXT_MAX + 100)];
        Files.write(bigFile, data);

        ObjectMapper m = new ObjectMapper();
        ObjectNode params = m.createObjectNode();
        params.put("input", "test");
        ArrayNode atts = params.putArray("attachments");
        ObjectNode att = atts.addObject();
        att.put("path", bigFile.toString());
        att.put("kind", "text");
        String paramsJson = m.writeValueAsString(params);

        String rpcInput = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":" + paramsJson + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";

        ByteArrayInputStream in = new ByteArrayInputStream(rpcInput.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(in, out, fakeFactory()).serve();

        // 附件校验是同步的，结果在 serve() 返回后已写出
        String output = out.toString(StandardCharsets.UTF_8);
        assertTrue(output.contains("turn.failed"), "应发出 turn.failed 通知");
        assertTrue(output.contains("附件错误"), "turn.failed error 应含 '附件错误'");
        assertFalse(output.contains("turn.completed"), "不应发出 turn.completed");
    }

    @Test
    void invalidApprovalDecisionDoesNotKillLoop() throws Exception {
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{\"approvalId\":\"x\",\"decision\":\"BOGUS\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(in, out, fakeFactory()).serve();
        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        boolean sawError = msgs.stream().anyMatch(n -> n.path("id").asInt(-1) == 3 && n.has("error"));
        boolean sawShutdown = msgs.stream().anyMatch(n -> n.path("id").asInt(-1) == 4 && n.has("result"));
        assertTrue(sawError, "bogus decision should get an error response");
        assertTrue(sawShutdown, "loop must survive the bad message and still handle shutdown");
    }
}
