package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 验证 turn.submit 的 mode 字段能透传到 SessionRunner.runTurn(4 参重载)。
 *
 * <p>使用 CountDownLatch 等待后台 turn 线程完成调用，避免与工作线程竞争。
 */
class AppServerTurnModeTest {

    /** 构造并运行 AppServer，返回所有 JSON-RPC 输出行(包含 notify)。 */
    private List<JsonNode> run(List<String> captured, String... requests) throws Exception {
        // 每条 turn.submit 各对应一个 latch 位，stub 收到调用即 countDown
        CountDownLatch latch = new CountDownLatch(requests.length);

        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer renderer = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                @Override
                public EventStreamRenderer renderer() { return renderer; }

                // 必须覆写 1 参基础方法满足接口（不含图时默认链末端）
                @Override
                public String runTurn(String input) { return "ok"; }

                // 覆写 4 参重载以捕获 mode
                @Override
                public String runTurn(String input,
                                      java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                                      java.util.List<String> imageNames,
                                      String mode) {
                    captured.add(mode);
                    latch.countDown();
                    return "ok";
                }
            };
        };

        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AppServer server = new AppServer(
                new ByteArrayInputStream(
                        String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, factory);

        // 在独立线程跑，因为 serve() 是阻塞的；包裹受检异常
        Thread serveThread = new Thread(() -> {
            try { server.serve(); } catch (Exception e) { throw new RuntimeException(e); }
        }, "test-serve");
        serveThread.setDaemon(true);
        serveThread.start();

        // 等待 stub 的所有调用完成（最多 5 秒）
        assertTrue(latch.await(5, TimeUnit.SECONDS),
                "超时：stub.runTurn 未在 5s 内被调用 " + requests.length + " 次");

        // 给 turn.completed notify 和 shutdown reply 一点时间写入
        serveThread.join(1000);

        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    // -------------------------------------------------------------------------
    // Test 1: mode="plan" 透传到 runTurn 4 参重载
    // -------------------------------------------------------------------------
    @Test
    void turnSubmit_withModePlan_passesModePlanToRunner() throws Exception {
        List<String> captured = new CopyOnWriteArrayList<>();
        run(captured,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"turn.submit\","
                + "\"params\":{\"input\":\"x\",\"mode\":\"plan\"}}");

        assertEquals(1, captured.size(), "stub 应被调用 1 次");
        assertEquals("plan", captured.get(0), "mode 应为 plan");
    }

    // -------------------------------------------------------------------------
    // Test 2: 不带 mode → 缺省 "react"
    // -------------------------------------------------------------------------
    @Test
    void turnSubmit_withoutMode_defaultsToReact() throws Exception {
        List<String> captured = new CopyOnWriteArrayList<>();
        run(captured,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"turn.submit\","
                + "\"params\":{\"input\":\"y\"}}");

        assertEquals(1, captured.size(), "stub 应被调用 1 次");
        assertEquals("react", captured.get(0), "缺省 mode 应为 react");
    }

    // -------------------------------------------------------------------------
    // Test 3: 两次请求顺序验证（plan → react）
    // -------------------------------------------------------------------------
    @Test
    void turnSubmit_planThenNoMode_capturesInOrder() throws Exception {
        // 两条 turn.submit 须串行发（AppServer 单会话一次只允许一个 turn），
        // 用分开的 run() 调用以避免 "turn in progress" 错误。
        List<String> captured = new CopyOnWriteArrayList<>();
        run(captured,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"turn.submit\","
                + "\"params\":{\"input\":\"x\",\"mode\":\"plan\"}}");
        // 再起一次 AppServer（新 session）发不带 mode 的
        run(captured,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"turn.submit\","
                + "\"params\":{\"input\":\"x\"}}");

        assertEquals(2, captured.size());
        assertEquals("plan",  captured.get(0));
        assertEquals("react", captured.get(1));
    }
}
