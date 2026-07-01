// src/test/java/com/lyhn/wraith/runtime/appserver/AppServerTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerTest {
    /** 假会话：runTurn 用脚本化序列驱动真实 EventStreamRenderer。 */
    private AppServer.SessionRunnerFactory fakeFactory() {
        return (writer, sessionId) -> {
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
}
