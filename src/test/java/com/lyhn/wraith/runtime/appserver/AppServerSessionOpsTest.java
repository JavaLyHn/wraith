package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import com.lyhn.wraith.session.SessionStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class AppServerSessionOpsTest {

    @TempDir Path home;

    /** 预置一个会话,返回其 id。 */
    private String seed() {
        SessionStore s = SessionStore.open(home, "/proj", "deepseek", "deepseek-chat");
        s.startNew();
        s.persist(List.of(LlmClient.Message.user("hello")));
        return s.currentId();
    }

    /** 每个请求前先 session.start;factory 的 SessionRunner 用共享 SessionStore。 */
    private List<JsonNode> run(String... requests) throws Exception {
        SessionStore store = SessionStore.open(home, "/proj", "deepseek", "deepseek-chat");
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public List<SessionMeta> listSessions() { return store.list(50); }
            public boolean setSessionStarred(String id, boolean starred) { return store.setStarred(id, starred); }
            public boolean renameSession(String id, String name) { return store.rename(id, name); }
            public boolean deleteSession(String id) { return store.deleteById(id); }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst()
                .orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    @Test void setStarredThenListShowsStarred() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setStarred\",\"params\":{\"sessionId\":\"" + sid + "\",\"starred\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        JsonNode s0 = byId(r, 3).path("result").path("sessions").get(0);
        assertTrue(s0.path("starred").asBoolean(), "list 里该会话应 starred=true");
    }

    @Test void renameThenListShowsName() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.rename\",\"params\":{\"sessionId\":\"" + sid + "\",\"name\":\"部署脚本\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        assertEquals("部署脚本", byId(r, 3).path("result").path("sessions").get(0).path("name").asText());
    }

    @Test void deleteThenListEmpty() throws Exception {
        String sid = seed();
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.delete\",\"params\":{\"sessionId\":\"" + sid + "\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.list\",\"params\":{}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
        assertEquals(0, byId(r, 3).path("result").path("sessions").size());
    }

    @Test void missingSessionIdIsParamError() throws Exception {
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setStarred\",\"params\":{\"starred\":true}}");
        assertNotNull(byId(r, 2).get("error"));
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void missingSessionIdInRenameIsParamError() throws Exception {
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.rename\",\"params\":{\"name\":\"x\"}}");
        assertNotNull(byId(r, 2).get("error"));
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }

    @Test void missingSessionIdInDeleteIsParamError() throws Exception {
        List<JsonNode> r = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.delete\",\"params\":{}}");
        assertNotNull(byId(r, 2).get("error"));
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
}
