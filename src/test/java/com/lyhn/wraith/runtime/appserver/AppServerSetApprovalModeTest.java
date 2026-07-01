package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSetApprovalModeTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void setApprovalModeReachesRunnerAndRepliesOk() throws Exception {
        AtomicReference<Boolean> recorded = new AtomicReference<>(null);
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return ""; }
                public void setApprovalMode(boolean auto) { recorded.set(auto); }
            };
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.setApprovalMode\",\"params\":{\"auto\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        new AppServer(in, out, factory).serve();

        assertEquals(Boolean.TRUE, recorded.get(), "runner.setApprovalMode 应收到 auto=true");
        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        boolean okReply = msgs.stream().anyMatch(n ->
                n.path("id").asInt(-1) == 2 && n.path("result").path("ok").asBoolean(false));
        assertTrue(okReply, "session.setApprovalMode 应回 {ok:true}");
    }

    @Test
    void setApprovalModeWithoutSessionErrors() throws Exception {
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> null;
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.setApprovalMode\",\"params\":{\"auto\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(in, out, factory).serve();
        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        boolean err = msgs.stream().anyMatch(n -> n.path("id").asInt(-1) == 1 && n.has("error"));
        assertTrue(err, "无 session → error");
    }
}
