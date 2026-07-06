package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSkillsTest {
    private List<JsonNode> run(String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> skillsList() {
                return Map.of("skills", List.of(Map.of(
                    "name", "web-access", "description", "联网手册", "version", "1.0.0",
                    "author", "Wraith CLI", "tags", List.of("web", "browser"),
                    "source", "builtin", "enabled", true)));
            }
            public Map<String,Object> skillsSetEnabled(String name, boolean enabled) {
                return Map.of("ok", true);
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String r : requests) lines.add(r.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }
    private JsonNode byId(List<JsonNode> r, int id) {
        return r.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test void listReturnsSkillsWithSourceAndEnabled() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        JsonNode skills = byId(r, 2).path("result").path("skills");
        assertTrue(skills.isArray());
        JsonNode s0 = skills.get(0);
        assertEquals("web-access", s0.path("name").asText());
        assertEquals("builtin", s0.path("source").asText());
        assertTrue(s0.path("enabled").asBoolean());
        assertTrue(s0.path("tags").isArray());
    }
    @Test void setEnabledOk() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.setEnabled\",\"params\":{\"name\":\"web-access\",\"enabled\":false}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
    }
    @Test void setEnabledMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.setEnabled\",\"params\":{\"enabled\":true}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
}
