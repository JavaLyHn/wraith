package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
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
            public Map<String,Object> sttTranscribe(String audioBase64, String mime) {
                return Map.of("text", "你好 world");
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

    private List<JsonNode> runWithStore(Path tmp, String... requests) throws Exception {
        Path cache = tmp.resolve("cache"), user = tmp.resolve("user"), project = tmp.resolve("project");
        com.lyhn.wraith.skill.SkillStateStore stateStore =
                new com.lyhn.wraith.skill.SkillStateStore(tmp.resolve("skills.json"));
        com.lyhn.wraith.skill.SkillRegistry registry =
                new com.lyhn.wraith.skill.SkillRegistry(cache, user, project, stateStore);
        registry.reload();
        com.lyhn.wraith.skill.SkillStore store = new com.lyhn.wraith.skill.SkillStore(user, project);
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> skillsList() {
                List<Map<String,Object>> list = new ArrayList<>();
                var disabled = registry.stateStore().disabled();
                for (var s : registry.allSkills()) list.add(Map.of(
                    "name", s.name(), "description", s.description(),
                    "version", s.version()==null?"":s.version(), "author", s.author()==null?"":s.author(),
                    "tags", s.tags(), "source", s.displaySource(), "enabled", !disabled.contains(s.name())));
                return Map.of("skills", list);
            }
            public Map<String,Object> skillsGet(String name) {
                var s = registry.findAnySkill(name);
                if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                Map<String,Object> v = new LinkedHashMap<>();
                v.put("name", s.name()); v.put("description", s.description());
                v.put("version", s.version()==null?"":s.version()); v.put("author", s.author()==null?"":s.author());
                v.put("tags", s.tags()); v.put("source", s.displaySource());
                v.put("enabled", !registry.stateStore().disabled().contains(s.name())); v.put("body", s.body());
                return v;
            }
            public Map<String,Object> skillsUpsert(String scope, String name, String description,
                    String version, String author, List<String> tags, String body, java.util.List<java.util.Map<String, String>> references) {
                try { store.upsert(scope, name, description, version, author, tags, body); }
                catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true);
            }
            public Map<String,Object> skillsDelete(String scope, String name) {
                try { store.delete(scope, name); } catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true);
            }
            public Map<String,Object> skillsFork(String name) {
                var s = registry.findAnySkill(name);
                if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                try { store.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body()); }
                catch (java.io.IOException e) { throw new RuntimeException(e); }
                registry.reload();
                return Map.of("ok", true, "name", s.name());
            }
            public Map<String,Object> skillsExistsInScope(String scope, String name) {
                return Map.of("exists", store.existsInScope(scope, name));
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

    @Test void upsertThenListShowsUserSkill(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"tags\":[\"t1\"],\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        JsonNode skills = byId(r, 3).path("result").path("skills");
        assertEquals(1, skills.size());
        assertEquals("mine", skills.get(0).path("name").asText());
        assertEquals("user", skills.get(0).path("source").asText());
    }

    @Test void getReturnsBody(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"body\":\"正文内容\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.get\",\"params\":{\"name\":\"mine\"}}");
        assertEquals("正文内容", byId(r, 3).path("result").path("body").asText());
    }

    @Test void deleteRemovesSkill(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"description\":\"D\",\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.delete\",\"params\":{\"scope\":\"user\",\"name\":\"mine\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 3).path("result").path("ok").asBoolean());
        assertEquals(0, byId(r, 4).path("result").path("skills").size());
    }

    @Test void forkCreatesUserCopyOverridingProject(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"project\",\"name\":\"base\",\"description\":\"orig\",\"body\":\"X\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.fork\",\"params\":{\"name\":\"base\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        assertTrue(byId(r, 3).path("result").path("ok").asBoolean());
        assertEquals("base", byId(r, 3).path("result").path("name").asText());
        JsonNode skills = byId(r, 4).path("result").path("skills");
        assertEquals(1, skills.size());
        assertEquals("user", skills.get(0).path("source").asText());
    }

    @Test void getMissingSkillIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.get\",\"params\":{\"name\":\"nope\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertUnsafeNameIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"../evil\",\"body\":\"x\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertBuiltinScopeIsParamError(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"builtin\",\"name\":\"x\",\"body\":\"y\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void upsertMissingScopeIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"name\":\"x\",\"body\":\"y\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void deleteMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.delete\",\"params\":{\"scope\":\"user\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void existsInScopeTrueForPresentPerScope(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"user\",\"name\":\"mine\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"project\",\"name\":\"mine\"}}");
        assertTrue(byId(r, 3).path("result").path("exists").asBoolean());
        assertFalse(byId(r, 4).path("result").path("exists").asBoolean());
    }

    @Test void existsInScopeMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"user\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void sttTranscribeReturnsText() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"stt.transcribe\",\"params\":{\"audioBase64\":\"YWJj\",\"mime\":\"audio/webm\"}}");
        assertEquals("你好 world", byId(r, 2).path("result").path("text").asText());
    }
    @Test void sttTranscribeMissingAudioIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"stt.transcribe\",\"params\":{\"mime\":\"audio/webm\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
}
