package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class AppServerWorkspaceDirTest {

    private static final ObjectMapper M = new ObjectMapper();

    private List<JsonNode> drive(AppServer.SessionRunnerFactory factory, List<String> requests) throws Exception {
        PipedInputStream serverIn = new PipedInputStream();
        PipedOutputStream feeder = new PipedOutputStream(serverIn);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AppServer server = new AppServer(serverIn, out, factory);
        Thread t = new Thread(() -> { try { server.serve(); } catch (Exception ignored) {} }, "test-serve");
        t.setDaemon(true); t.start();
        for (String req : requests) {
            feeder.write((req + "\n").getBytes(StandardCharsets.UTF_8)); feeder.flush(); Thread.sleep(50);
        }
        feeder.write("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}\n"
                .getBytes(StandardCharsets.UTF_8));
        feeder.flush(); t.join(2000);
        List<JsonNode> lines = new java.util.ArrayList<>();
        for (String l : out.toString(StandardCharsets.UTF_8).split("\n")) if (!l.isBlank()) lines.add(M.readTree(l));
        return lines;
    }

    private JsonNode forId(List<JsonNode> lines, int id) {
        return lines.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElse(null);
    }

    private AppServer.SessionRunnerFactory capturingFactory(AtomicReference<String> captured) {
        return (writer, sessionId, workspaceDir) -> {
            captured.set(workspaceDir);
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return ""; }
            };
        };
    }

    @Test
    void validWorkspaceDirPassedToFactory() throws Exception {
        Path dir = Files.createTempDirectory("wraith-ws-");
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        List<JsonNode> lines = drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{\"workspaceDir\":\"" + dir + "\"}}"));
        assertEquals(dir.toString(), captured.get(), "有效 workspaceDir 应透传给 factory");
        assertTrue(forId(lines, 2).path("result").hasNonNull("sessionId"));
    }

    @Test
    void missingWorkspaceDirPassesNull() throws Exception {
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}"));
        assertNull(captured.get(), "缺省 workspaceDir 应传 null");
    }

    @Test
    void invalidWorkspaceDirRejectedWith32602() throws Exception {
        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        List<JsonNode> lines = drive(capturingFactory(captured), List.of(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{\"workspaceDir\":\"/no/such/dir/xyz123\"}}"));
        assertEquals(-32602, forId(lines, 2).path("error").path("code").asInt(), "无效目录应 -32602");
        assertEquals("UNSET", captured.get(), "无效目录不应创建会话/调用 factory");
    }
}
