package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerMcpDispatchTest {

    private List<JsonNode> run(String... requests) throws Exception {
        List<String> calls = new ArrayList<>();
        return run(calls, requests);
    }

    private List<JsonNode> run(List<String> calls, String... requests) throws Exception {
        return run(calls, null, requests);
    }

    private List<JsonNode> run(List<String> calls, McpOps customOps, String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            McpOps ops = customOps != null ? customOps : new McpOps() {
                public Map<String, Object> list() { calls.add("list"); return Map.of("servers", List.of()); }
                public void enable(String n) { calls.add("enable:" + n); if ("ghost".equals(n)) throw new NoSuchElementException("未知"); }
                public void disable(String n) { calls.add("disable:" + n); }
                public void restart(String n) { calls.add("restart:" + n); }
                public String logs(String n) { calls.add("logs:" + n); return "L1\nL2"; }
                public List<Map<String, Object>> resources(String n) { calls.add("resources:" + n); return List.of(Map.of("server", "s", "uri", "u", "name", "r")); }
                public String prompts(String n) { calls.add("prompts:" + n); return "PTEXT"; }
                public void configUpsert(String sc, String n, String c, List<String> a, Map<String, String> e) { calls.add("upsert:" + sc + ":" + n); if ("bad".equals(sc)) throw new IllegalArgumentException("scope"); }
                public boolean configRemove(String sc, String n) { calls.add("remove:" + sc + ":" + n); return true; }
            };
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public McpOps mcp() { return ops; }
            };
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test
    void listAndLogsAndPromptsReturnResults() throws Exception {
        List<JsonNode> r = run(
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.logs\",\"params\":{\"name\":\"srv\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.prompts\",\"params\":{\"name\":\"srv\"}}");
        assertTrue(byId(r, 2).get("result").has("servers"));
        assertEquals("L1\nL2", byId(r, 3).get("result").get("lines").asText());
        assertEquals("PTEXT", byId(r, 4).get("result").get("text").asText());
    }

    @Test
    void mutatingOpsDispatchAndReturnOk() throws Exception {
        List<String> calls = new ArrayList<>();
        List<JsonNode> r = run(calls,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.disable\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.restart\",\"params\":{\"name\":\"a\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"a\",\"command\":\"c\",\"args\":[\"x\"],\"env\":{\"K\":\"v\"}}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.remove\",\"params\":{\"scope\":\"user\",\"name\":\"a\"}}");
        for (int id = 2; id <= 6; id++) assertTrue(byId(r, id).get("result").get("ok").asBoolean());
        assertEquals(List.of("enable:a", "disable:a", "restart:a", "upsert:user:a", "remove:user:a"), calls);
    }

    @Test
    void resourcesWithAndWithoutName() throws Exception {
        List<String> calls = new ArrayList<>();
        List<JsonNode> r = run(calls,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.resources\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.resources\",\"params\":{\"name\":\"srv\"}}");
        assertEquals(1, byId(r, 2).get("result").get("resources").size());
        assertEquals(List.of("resources:null", "resources:srv"), calls);
    }

    @Test
    void errorPaths() throws Exception {
        List<JsonNode> r = run(
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{}}",                    // 缺 name → -32602
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{\"name\":\"ghost\"}}",  // 未知 → -32000
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.upsert\",\"params\":{\"scope\":\"bad\",\"name\":\"a\",\"command\":\"c\"}}",  // IAE → -32602
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.enable\",\"params\":{\"name\":\"  \"}}");     // blank name → -32602
        assertEquals(-32602, byId(r, 2).get("error").get("code").asInt());
        assertEquals(-32000, byId(r, 3).get("error").get("code").asInt());
        assertEquals(-32602, byId(r, 4).get("error").get("code").asInt());
        assertEquals(-32602, byId(r, 5).get("error").get("code").asInt());
    }

    @Test
    void noSessionAndNoOpsReturnErrors() throws Exception {
        // 无会话:直接发 mcp.list(不先 session.start)
        AppServer.SessionRunnerFactory f = (w, sid, ws) -> {
            EventStreamRenderer r = new EventStreamRenderer(w, sid);
            return new AppServer.SessionRunner() {  // mcp() 用默认 null
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"mcp.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        assertEquals(-32000, byId(replies, 1).get("error").get("code").asInt()); // no session
        assertEquals(-32000, byId(replies, 3).get("error").get("code").asInt()); // mcp unavailable
    }

    @Test
    void ioExceptionMapsTo32000WithPrefix() throws Exception {
        List<String> calls = new ArrayList<>();
        McpOps ops = new McpOps() {
            public Map<String, Object> list() { return Map.of("servers", List.of()); }
            public void enable(String n) { }
            public void disable(String n) { }
            public void restart(String n) { }
            public String logs(String n) { return ""; }
            public List<Map<String, Object>> resources(String n) { return List.of(); }
            public String prompts(String n) { return ""; }
            public void configUpsert(String sc, String n, String c, List<String> a, Map<String, String> e) throws IOException {
                throw new IOException("disk full");
            }
            public boolean configRemove(String sc, String n) { return true; }
        };
        List<JsonNode> r = run(calls, ops,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.config.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"a\",\"command\":\"c\"}}");
        JsonNode err = byId(r, 2).get("error");
        assertEquals(-32000, err.get("code").asInt());
        assertTrue(err.get("message").asText().startsWith("配置写入失败"));
    }

    @Test
    void illegalStateMapsTo32000() throws Exception {
        List<String> calls = new ArrayList<>();
        McpOps ops = new McpOps() {
            public Map<String, Object> list() { throw new IllegalStateException("mcp 未初始化"); }
            public void enable(String n) { }
            public void disable(String n) { }
            public void restart(String n) { }
            public String logs(String n) { return ""; }
            public List<Map<String, Object>> resources(String n) { return List.of(); }
            public String prompts(String n) { return ""; }
            public void configUpsert(String sc, String n, String c, List<String> a, Map<String, String> e) { }
            public boolean configRemove(String sc, String n) { return true; }
        };
        List<JsonNode> r = run(calls, ops,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.list\",\"params\":{}}");
        assertEquals(-32000, byId(r, 2).get("error").get("code").asInt());
    }
}
