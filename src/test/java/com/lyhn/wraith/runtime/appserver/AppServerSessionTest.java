package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSessionTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    /** Fake runner: canned list/resume, records persistTurn, returns a fixed persisted id. */
    private AppServer.SessionRunnerFactory factory(AtomicInteger persistCount) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { r.appendAssistantContentDelta("ok"); r.finishAssistantContent(); return "ok"; }
                public List<SessionMeta> listSessions() {
                    return List.of(new SessionMeta("s1", "/p", "c", "u", "prov", "mod", "hello world", 3, false, null, null));
                }
                public List<LlmClient.Message> resume(String id) {
                    return List.of(
                        new LlmClient.Message("user", "hi", null, null, null),
                        new LlmClient.Message("assistant", "yo", null, null, null));
                }
                public String persistTurn() { persistCount.incrementAndGet(); return "persisted-9"; }
            };
        };
    }

    @Test
    void sessionListSerializesMetas() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        JsonNode listResult = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow();
        JsonNode sessions = listResult.get("result").get("sessions");
        assertTrue(sessions.isArray() && sessions.size() == 1);
        assertEquals("s1", sessions.get(0).get("id").asText());
        assertEquals("hello world", sessions.get(0).get("title").asText());
        assertEquals(3, sessions.get(0).get("turns").asInt());
    }

    @Test
    void sessionResumeSerializesMessages() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"s1\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        assertEquals("s1", res.get("sessionId").asText());
        JsonNode msgs = res.get("messages");
        assertEquals(2, msgs.size());
        assertEquals("user", msgs.get(0).get("role").asText());
        assertEquals("hi", msgs.get(0).get("content").asText());
    }

    @Test
    void turnPersistsAndReportsRealSessionId() throws Exception {
        AtomicInteger persist = new AtomicInteger();
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(persist)).serve();
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && !out.toString(StandardCharsets.UTF_8).contains("turn.completed")) Thread.sleep(20);
        assertEquals(1, persist.get(), "persistTurn should be called once after the turn");
        JsonNode completed = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> "turn.completed".equals(n.path("method").asText(null))).findFirst().orElseThrow();
        assertEquals("persisted-9", completed.get("params").get("sessionId").asText(),
            "turn.completed should carry the real persisted sessionId");
    }

    @Test
    void rewindDispatchesToRunnerAndReturnsOk() throws Exception {
        AtomicInteger gotOrdinal = new AtomicInteger(-1);
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public boolean rewind(int userOrdinal) { gotOrdinal.set(userOrdinal); return true; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.rewind\",\"params\":{\"userOrdinal\":2}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        assertEquals(2, gotOrdinal.get());
        JsonNode ok = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow();
        assertTrue(ok.get("result").get("ok").asBoolean());
    }

    @Test
    void rewindInvalidOrdinalAndRunnerFailureReturnErrors() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public boolean rewind(int userOrdinal) { return false; } // runner 拒绝(如超界)
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.rewind\",\"params\":{\"userOrdinal\":1}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"session.rewind\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"session.rewind\",\"params\":{\"userOrdinal\":9}}",
            "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = parseAll(out.toString(StandardCharsets.UTF_8));
        assertEquals(-32000, replies.stream().filter(n -> n.path("id").asInt(-1) == 1 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt()); // no session
        assertEquals(-32602, replies.stream().filter(n -> n.path("id").asInt(-1) == 3 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt()); // missing userOrdinal
        assertEquals(-32000, replies.stream().filter(n -> n.path("id").asInt(-1) == 4 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt()); // runner false
    }

    @Test
    void listAndResumeWithoutSessionReturnNoSessionError() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"s1\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        List<JsonNode> replies = parseAll(out.toString(StandardCharsets.UTF_8));
        for (int id : new int[] {1, 2}) {
            final int wanted = id;
            JsonNode err = replies.stream()
                .filter(n -> n.path("id").asInt(-1) == wanted && n.has("error")).findFirst().orElseThrow();
            assertEquals(-32000, err.get("error").get("code").asInt());
            assertEquals("no session", err.get("error").get("message").asText());
        }
    }

    @Test
    void resumeWithMissingSessionIdReturnsInvalidParams() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.resume\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        List<JsonNode> replies = parseAll(out.toString(StandardCharsets.UTF_8));
        for (int id : new int[] {2, 3}) {
            final int wanted = id;
            JsonNode err = replies.stream()
                .filter(n -> n.path("id").asInt(-1) == wanted && n.has("error")).findFirst().orElseThrow();
            assertEquals(-32602, err.get("error").get("code").asInt());
            assertEquals("missing sessionId", err.get("error").get("message").asText());
        }
    }

    @Test
    void sessionPeekReadsMessagesAndCardsWithoutResuming() throws Exception {
        java.util.concurrent.atomic.AtomicInteger resumeCalls = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger peekCalls = new java.util.concurrent.atomic.AtomicInteger();
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<LlmClient.Message> resume(String id) { resumeCalls.incrementAndGet(); return List.of(); }
                public List<LlmClient.Message> peekSession(String id) {
                    peekCalls.incrementAndGet();
                    return List.of(new LlmClient.Message("user", "peeked-hi", null, null, null));
                }
                public List<JsonNode> readCards(String id) {
                    com.fasterxml.jackson.databind.node.ObjectNode n = JsonRpc.MAPPER.createObjectNode();
                    n.put("turnOrdinal", 1);
                    n.set("events", JsonRpc.MAPPER.createArrayNode());
                    return List.of(n);
                }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.peek\",\"params\":{\"sessionId\":\"s7\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        assertEquals("s7", res.get("sessionId").asText());
        assertEquals(1, res.get("messages").size());
        assertEquals("peeked-hi", res.get("messages").get(0).get("content").asText());
        assertTrue(res.get("cards").isArray() && res.get("cards").size() == 1);
        assertEquals(1, peekCalls.get(), "session.peek 必须走 peekSession");
        assertEquals(0, resumeCalls.get(), "session.peek 绝不能触发 resume(有副作用)");
    }

    @Test
    void sessionPeekGuardsNoSessionAndMissingId() throws Exception {
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.peek\",\"params\":{\"sessionId\":\"s1\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"session.peek\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory(new AtomicInteger())).serve();
        List<JsonNode> replies = parseAll(out.toString(StandardCharsets.UTF_8));
        assertEquals(-32000, replies.stream().filter(n -> n.path("id").asInt(-1) == 1 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt());   // no session
        assertEquals(-32602, replies.stream().filter(n -> n.path("id").asInt(-1) == 3 && n.has("error"))
            .findFirst().orElseThrow().get("error").get("code").asInt());   // missing sessionId
    }
}
