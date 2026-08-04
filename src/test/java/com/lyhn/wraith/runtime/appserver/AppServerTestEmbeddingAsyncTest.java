package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * embedding 的「测试连接」也必须 offload —— 同一个坑不许踩第二次。
 *
 * <p>{@code dispatch} 跑在 {@code serve()} 那条<b>唯一的</b> reader 线程上。
 * {@code config.testProvider}（LLM 那个按钮）当初就是同步执行，表现为
 * 「点了测试连接，整个桌面端都没反应」（见 {@link AppServerTestProviderAsyncTest}）。
 *
 * <p>embedding 探测的时间尺度更糟：ollama <b>首次</b>请求要把模型载进内存
 * （本机实测 nomic-embed-text 冷启动 0.6s、bge-m3 2.2s；大模型 + 慢盘会到几十秒），
 * 云端后端连不上时还要等 connect 超时。同步执行就是把整个 app-server 冻住那么久。
 *
 * <p><b>判别力自证</b>：把 AppServer 里 {@code config.testEmbedding} 那支改成
 * {@code writer.result(msg.id(), session.embeddingTest(...))} 同步版本，本测试超时变红。
 */
class AppServerTestEmbeddingAsyncTest {

    @Test
    @DisplayName("embedding 探测阻塞期间，后续 RPC 仍然回得来 —— reader 线程没被占住")
    void slowEmbeddingProbeDoesNotBlockLaterRpcs() throws Exception {
        CountDownLatch probeEntered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        WraithConfig cfg = new WraithConfig();

        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> modelList() {
                return ModelCatalog.result(cfg, "deepseek", "m", false);
            }
            public Map<String, Object> embeddingTest(String provider, String model,
                                                     String baseUrl, String apiKey) {
                probeEntered.countDown();
                try {
                    // 模拟「ollama 在冷启动大模型」——同步 dispatch 下这里会冻住整个 app-server
                    assertTrue(release.await(10, TimeUnit.SECONDS), "测试自身超时");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return Map.of("ok", true, "dim", 768, "latencyMs", 1L);
            }
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"config.testEmbedding\","
                        + "\"params\":{\"provider\":\"ollama\",\"model\":\"bge-m3\","
                        + "\"baseUrl\":\"http://localhost:11434\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"model.list\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}") + "\n";

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> {
            try {
                new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)),
                        out, f).serve();
            } catch (Exception ignored) {
                // serve() 的异常与本测试无关:这里只关心 id=3 有没有在探测阻塞期间回来
            }
        }, "test-appserver-embed");
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
            for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
                if (ln.isBlank()) continue;
                try {
                    if (JsonRpc.MAPPER.readTree(ln).path("id").asInt(-1) == wanted) return true;
                } catch (Exception partial) {
                    // 另一条线程可能刚写完 bytes 还没写 '\n' —— 半截行,下一轮再读
                }
            }
            Thread.sleep(10);
        }
        return false;
    }
}
