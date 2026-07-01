// src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererTest.java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class EventStreamRendererTest {
    private record Captured(ByteArrayOutputStream out, EventStreamRenderer r) {}

    private Captured make() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer r = new EventStreamRenderer(new JsonRpcWriter(out), "sess_1");
        r.setCurrentTurnId("turn_1");
        return new Captured(out, r);
    }

    private List<JsonNode> lines(ByteArrayOutputStream out) throws Exception {
        String s = out.toString(StandardCharsets.UTF_8);
        java.util.ArrayList<JsonNode> list = new java.util.ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) list.add(JsonRpc.MAPPER.readTree(ln));
        return list;
    }

    @Test
    void thinkingAndContentDeltaEmitNotifications() throws Exception {
        Captured c = make();
        c.r().appendThinking("想…");
        c.r().appendAssistantContentDelta("答");
        List<JsonNode> ls = lines(c.out());
        assertEquals("thinking.delta", ls.get(0).get("method").asText());
        assertEquals("想…", ls.get(0).get("params").get("text").asText());
        assertEquals("turn_1", ls.get(0).get("params").get("turnId").asText());
        assertEquals("message.delta", ls.get(1).get("method").asText());
        assertEquals("答", ls.get(1).get("params").get("text").asText());
    }

    @Test
    void toolCallEmitsCallIdNameArgs() throws Exception {
        Captured c = make();
        LlmClient.ToolCall tc = new LlmClient.ToolCall("call_9",
                new LlmClient.ToolCall.Function("execute_command", "{\"command\":\"ls\"}"));
        c.r().appendToolCalls(List.of(tc));
        JsonNode p = lines(c.out()).get(0).get("params");
        assertEquals("tool.call", lines(c.out()).get(0).get("method").asText());
        assertEquals("call_9", p.get("callId").asText());
        assertEquals("execute_command", p.get("name").asText());
        assertEquals("{\"command\":\"ls\"}", p.get("argsJson").asText());
    }

    @Test
    void diffEmitsBeforeAfter() throws Exception {
        Captured c = make();
        c.r().appendDiff("a.txt", "old", "new");
        JsonNode p = lines(c.out()).get(0).get("params");
        assertEquals("diff", lines(c.out()).get(0).get("method").asText());
        assertEquals("a.txt", p.get("file").asText());
        assertEquals("old", p.get("before").asText());
        assertEquals("new", p.get("after").asText());
    }

    @Test
    void streamIsDiscardingNotStdout() {
        Captured c = make();
        c.r().stream().println("THIS MUST NOT POLLUTE STDOUT");
        assertEquals(0, c.out().size(), "stream() 输出不得进入 JSON-RPC 通道");
    }
}
