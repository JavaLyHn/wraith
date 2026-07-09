package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerToolsTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void toolsListSerializesBuiltinToolDefinitions() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<LlmClient.Tool> builtinTools() {
                    ObjectNode params = JsonRpc.MAPPER.createObjectNode();
                    params.put("type", "object");
                    return List.of(
                        new LlmClient.Tool("read_file", "读取文件", params),
                        new LlmClient.Tool("save_memory", "保存记忆", null));  // parameters=null → 省略
                }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        JsonNode tools = res.get("tools");
        assertEquals(2, tools.size());
        assertEquals("read_file", tools.get(0).get("name").asText());
        assertEquals("读取文件", tools.get(0).get("description").asText());
        assertEquals("object", tools.get(0).get("parameters").get("type").asText());
        assertEquals("save_memory", tools.get(1).get("name").asText());
        assertFalse(tools.get(1).has("parameters"), "parameters 为 null 时应省略该字段");
    }

    @Test
    void toolsListWithoutSessionReturnsNoSession() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode err = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 1 && n.has("error")).findFirst().orElseThrow();
        assertEquals(-32000, err.get("error").get("code").asInt());
        assertEquals("no session", err.get("error").get("message").asText());
    }
}
