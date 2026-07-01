package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class AppServerInitializeAndGuardTest {

    private static final ObjectMapper M = new ObjectMapper();

    /** 把若干 JSON-RPC 行喂给 app-server,serve 在后台线程跑,返回 stdout 全部输出行(解析成 JsonNode)。 */
    private List<JsonNode> drive(AppServer.SessionRunnerFactory factory,
                                 Map<String, Object> initResult,
                                 List<String> requests,
                                 CountDownLatch releaseAfterWrite) throws Exception {
        PipedInputStream serverIn = new PipedInputStream();
        PipedOutputStream feeder = new PipedOutputStream(serverIn);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        AppServer server = new AppServer(serverIn, out, factory, initResult);
        Thread t = new Thread(() -> { try { server.serve(); } catch (Exception ignored) {} }, "test-serve");
        t.setDaemon(true);
        t.start();

        for (String req : requests) {
            feeder.write((req + "\n").getBytes(StandardCharsets.UTF_8));
            feeder.flush();
            Thread.sleep(60); // 让 serve 顺序处理该行
        }
        if (releaseAfterWrite != null) releaseAfterWrite.countDown();
        Thread.sleep(150);
        feeder.write(("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feeder.flush();
        t.join(2000);

        List<JsonNode> lines = new java.util.ArrayList<>();
        for (String l : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (!l.isBlank()) lines.add(M.readTree(l));
        }
        return lines;
    }

    private JsonNode responseForId(List<JsonNode> lines, int id) {
        return lines.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElse(null);
    }

    /** 只需一个能返回真实 EventStreamRenderer 的 fake runner;runTurn 阻塞在 latch 上模拟"进行中"。 */
    private AppServer.SessionRunnerFactory latchFactory(CountDownLatch latch) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer renderer = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return renderer; }
                public String runTurn(String input) throws Exception { latch.await(5, TimeUnit.SECONDS); return ""; }
            };
        };
    }

    @Test
    void initializeReturnsConfiguredResult() throws Exception {
        Map<String, Object> init = new java.util.LinkedHashMap<>();
        init.put("serverInfo", "wraith-app-server");
        init.put("protocol", "1");
        init.put("model", "deepseek-chat");
        init.put("capabilities", Map.of("streaming", true, "toolOutputStreaming", true));

        List<JsonNode> lines = drive(latchFactory(new CountDownLatch(0)), init,
                List.of("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}"), null);

        JsonNode r = responseForId(lines, 1);
        assertNotNull(r, "应有 id=1 的响应");
        assertEquals("deepseek-chat", r.path("result").path("model").asText());
        assertTrue(r.path("result").path("capabilities").path("toolOutputStreaming").asBoolean());
        assertEquals("wraith-app-server", r.path("result").path("serverInfo").asText());
        assertEquals("1", r.path("result").path("protocol").asText());
    }

    @Test
    void secondTurnWhileRunningIsRejected() throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        List<JsonNode> lines = drive(latchFactory(latch), Map.of("serverInfo", "x", "protocol", "1"),
                List.of(
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.start\",\"params\":{}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"turn.submit\",\"params\":{\"input\":\"a\"}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"turn.submit\",\"params\":{\"input\":\"b\"}}"
                ), latch);

        JsonNode first = responseForId(lines, 3);
        JsonNode second = responseForId(lines, 4);
        assertEquals("running", first.path("result").path("status").asText(), "第一轮应 running");
        assertEquals(-32000, second.path("error").path("code").asInt(), "并发第二轮应被 -32000 拒绝");
    }
}
