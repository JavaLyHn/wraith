package com.lyhn.wraith.rag;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 整库索引有上千次 embedding 调用,免费额度带 RPM 上限 —— 撞上 429 是常态。撞一次就丢一个代码块的话
 * 每次索引都会残缺,所以 429/5xx 必须退避重试。
 *
 * <p>但反过来同样重要:**4xx 不能重试**。key 填错(401)或模型名写错(400)是必然失败,
 * 每块重试 4 次只会把「立刻报错」变成「慢 4 倍后报错」,7000 块就是几十分钟的无效等待。
 *
 * <p>用真的 HTTP server 测,不用桩 —— 重试逻辑在 {@code postJson} 里,桩掉 {@code embed} 就绕过了它
 * (这正是第一版测试自欺的地方)。
 */
class EmbeddingRetryTest {

    private HttpServer server;
    private int port;
    private final List<String> hits = new CopyOnWriteArrayList<>();
    private String prevRetries;

    private static final String OK_BODY = "{\"data\":[{\"embedding\":[0.1,0.2,0.3]}]}";

    @BeforeEach
    void start() throws Exception {
        prevRetries = System.getProperty("wraith.embed.retries");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        server.start();
    }

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
        if (prevRetries == null) System.clearProperty("wraith.embed.retries");
        else System.setProperty("wraith.embed.retries", prevRetries);
    }

    /** 前 failTimes 次回 status,之后回 200。 */
    private void respondWith(int status, int failTimes, String retryAfter) {
        AtomicInteger n = new AtomicInteger();
        server.createContext("/v1/embeddings", exchange -> {
            hits.add(exchange.getRequestMethod());
            boolean fail = n.getAndIncrement() < failTimes;
            byte[] body = (fail ? "{\"error\":\"boom\"}" : OK_BODY).getBytes(StandardCharsets.UTF_8);
            if (fail && retryAfter != null) exchange.getResponseHeaders().add("Retry-After", retryAfter);
            exchange.sendResponseHeaders(fail ? status : 200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
    }

    private EmbeddingClient client() {
        return EmbeddingClient.of("openai", "test-model", "http://127.0.0.1:" + port + "/v1", "k");
    }

    @Test
    void retriesOn429AndEventuallySucceeds() throws Exception {
        respondWith(429, 2, null);
        float[] v = client().embed("hello");
        assertEquals(3, v.length, "重试成功后应拿到向量");
        assertEquals(3, hits.size(), "应为 2 次 429 + 1 次成功,实际请求数=" + hits.size());
    }

    @Test
    void retriesOn503AsWell() throws Exception {
        respondWith(503, 1, null);
        assertEquals(3, client().embed("hello").length);
        assertEquals(2, hits.size(), "5xx 也该重试,实际请求数=" + hits.size());
    }

    @Test
    void honorsRetryAfterHeader() throws Exception {
        respondWith(429, 1, "0.2");
        long start = System.nanoTime();
        client().embed("hello");
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertEquals(2, hits.size());
        // Retry-After: 0.2s 应该被听进去 —— 否则会走指数退避的 500ms 起步
        assertTrue(elapsedMs < 450, "没听 Retry-After,等了 " + elapsedMs + "ms(退避默认 500ms 起)");
    }

    @Test
    void doesNotRetryOn401BadApiKey() {
        respondWith(401, 99, null);
        IOException e = assertThrows(IOException.class, () -> client().embed("hello"));
        assertEquals(1, hits.size(),
                "401 被重试了 " + hits.size() + " 次 —— key 填错是必然失败,重试只会让整库索引慢几倍");
        assertTrue(e.getMessage().contains("401"), "错误里要带上状态码,不然没法诊断:" + e.getMessage());
    }

    @Test
    void doesNotRetryOn400BadModelName() {
        respondWith(400, 99, null);
        assertThrows(IOException.class, () -> client().embed("hello"));
        assertEquals(1, hits.size(), "400 不该重试,实际请求数=" + hits.size());
    }

    @Test
    void givesUpAfterConfiguredAttemptsAndSaysSo() {
        System.setProperty("wraith.embed.retries", "2");
        respondWith(429, 99, null);
        IOException e = assertThrows(IOException.class, () -> client().embed("hello"));
        assertEquals(2, hits.size(), "应恰好尝试 2 次,实际=" + hits.size());
        assertTrue(e.getMessage().contains("重试"), "放弃时要说明是重试耗尽:" + e.getMessage());
        assertTrue(e.getMessage().contains("429"), "要保留最后一次的状态码:" + e.getMessage());
    }
}
