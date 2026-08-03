package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「点了测试连接，整个桌面端都没反应」的守门人。
 *
 * <p><b>根因</b>：{@code dispatch} 跑在 {@code serve()} 那条<b>唯一的</b> reader 线程上
 * （{@code while ((line = in.readLine()) != null)}），而 {@code config.testProvider} 的探测是
 * 一次真实 HTTP 调用 —— 复用 {@code SHARED_HTTP_CLIENT} 的超时（connect 60s / read 300s /
 * <b>callTimeout 600s</b>，那套是按真实对话调的）。同步执行时那条线程被占住，期间
 * <b>任何</b> RPC 都处理不了：不只是那个按钮，整个桌面端都是死的。
 *
 * <p>修法是挪到早就存在的 {@code dispatchAsync}（{@code browserTabs} 已在用；
 * {@code JsonRpcWriter.writeLine} 整段 synchronized，所以并发帧不会交错）。
 *
 * <p>这条测试是本来就该抓住它的那条：让探测阻塞住，后面那条 {@code model.list} 仍必须回得来。
 * <b>判别力自证</b>：把 AppServer 里 {@code config.testProvider} 那支改回
 * {@code writer.result(msg.id(), session.configTestProvider(...))} 同步版本，本测试超时变红。
 */
class AppServerTestProviderAsyncTest {

    @Test
    @DisplayName("探测阻塞期间，后续 RPC 仍然回得来 —— reader 线程没被占住")
    void slowProbeDoesNotBlockLaterRpcs() throws Exception {
        CountDownLatch probeEntered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        WraithConfig cfg = new WraithConfig();

        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> modelList() {
                return ModelCatalog.result(cfg, "deepseek", "m", false);
            }
            public Map<String, Object> configTestProvider(String id, String apiKey, String model,
                                                          String baseUrl, String protocol) {
                probeEntered.countDown();
                try {
                    // 模拟「baseUrl 能连上但不回应」——同步 dispatch 下这里会冻住整个 app-server
                    assertTrue(release.await(10, TimeUnit.SECONDS), "测试自身超时");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return Map.of("ok", true, "model", "probe", "latencyMs", 1L);
            }
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"config.testProvider\","
                        + "\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-fake\",\"model\":\"gpt-4o\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"model.list\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}") + "\n";

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> {
            try {
                new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)), out, f).serve();
            } catch (Exception ignored) {
                // serve() 的异常与本测试无关:这里只关心 id=3 有没有在探测阻塞期间回来
            }
        }, "test-appserver");
        server.setDaemon(true);
        server.start();

        assertTrue(probeEntered.await(5, TimeUnit.SECONDS), "探测没被调用");

        // 关键断言:探测还卡着,id=3 就必须已经回了。同步 dispatch 下这里会等到超时。
        assertTrue(awaitId(out, 3, 5), "探测阻塞期间 model.list 没回来 —— reader 线程被占住了");

        release.countDown();
        assertTrue(awaitId(out, 2, 5), "放开后探测本身也该回");
        server.join(TimeUnit.SECONDS.toMillis(5));
    }

    /** 轮询直到出现 id=wanted 的回帧（等条件，不用固定 sleep）。 */
    private static boolean awaitId(ByteArrayOutputStream out, int wanted, long timeoutSeconds)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        while (System.nanoTime() < deadline) {
            for (JsonNode n : parse(out)) {
                if (n.path("id").asInt(-1) == wanted) return true;
            }
            Thread.sleep(10);
        }
        return false;
    }

    private static List<JsonNode> parse(ByteArrayOutputStream out) {
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (ln.isBlank()) continue;
            try {
                replies.add(JsonRpc.MAPPER.readTree(ln));
            } catch (Exception partial) {
                // 另一条线程可能刚写完 bytes 还没写 '\n' —— 半截行，下一轮再读
            }
        }
        return replies;
    }

    @Test
    @DisplayName("回帧带的是请求自己的 id —— 异步之后不能张冠李戴")
    void asyncReplyCarriesItsOwnId() throws Exception {
        WraithConfig cfg = new WraithConfig();
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> modelList() {
                return ModelCatalog.result(cfg, "deepseek", "m", false);
            }
            public Map<String, Object> configTestProvider(String id, String apiKey, String model,
                                                          String baseUrl, String protocol) {
                return Map.of("ok", true, "model", model, "latencyMs", 7L);
            }
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":42,\"method\":\"config.testProvider\","
                        + "\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-fake\",\"model\":\"gpt-4o\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}") + "\n";

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)), out, f).serve();

        assertTrue(awaitId(out, 42, 5), "id=42 的回帧没出现");
        JsonNode reply = parse(out).stream()
                .filter(n -> n.path("id").asInt(-1) == 42).findFirst().orElseThrow();
        assertEquals("gpt-4o", reply.path("result").path("model").asText());
    }
}
