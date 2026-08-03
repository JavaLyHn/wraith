package com.lyhn.wraith.web;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DuckDuckGo 后端是本设计里唯一零 key 的路，也是唯一被明确判定为**不可靠**的一条。
 * 它靠抓 html.duckduckgo.com 的页面标记，改版或限流都会让它碎。
 *
 * <p><b>失败契约是它能被接受的前提</b>：HTTP 非 200、被限流、或解析出 0 条结果，
 * 一律抛 IOException，<b>绝不返回空列表</b>。空列表和「网上没有这个信息」在模型眼里
 * 是同一件事，它会据此编造结论；异常则明确是「工具坏了」。
 *
 * <p>全程走 MockWebServer + 注入的 OkHttpClient，<b>不真连 duckduckgo.com</b>。
 */
class DuckDuckGoProviderTest {

    private MockWebServer server;
    private OkHttpClient client;

    @BeforeEach
    void setup() throws IOException {
        server = new MockWebServer();
        server.start();
        client = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS)
                .build();
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    private DuckDuckGoSearchProvider provider() {
        return new DuckDuckGoSearchProvider(server.url("/html/").toString(), client);
    }

    private static final String TWO_RESULTS = """
            <html><body>
              <div class="result">
                <a class="result__a" href="https://example.com/alpha">Alpha 标题</a>
                <a class="result__snippet">Alpha 摘要文字</a>
              </div>
              <div class="result">
                <a class="result__a" href="https://example.org/beta">Beta 标题</a>
                <a class="result__snippet">Beta 摘要文字</a>
              </div>
            </body></html>
            """;

    @Test
    @DisplayName("解析出标题 / 链接 / 摘要 / 位置")
    void parsesResultsFromHtml() throws IOException {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        List<SearchResult> results = provider().search("任意关键词", 5);

        assertEquals(2, results.size());
        assertEquals(1, results.get(0).position());
        assertEquals("Alpha 标题", results.get(0).title());
        assertEquals("https://example.com/alpha", results.get(0).url());
        assertEquals("Alpha 摘要文字", results.get(0).snippet());
        assertEquals("example.com", results.get(0).source());
        assertEquals(2, results.get(1).position());
        assertEquals("https://example.org/beta", results.get(1).url());
    }

    @Test
    @DisplayName("topK 截断")
    void truncatesToTopK() throws IOException {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        assertEquals(1, provider().search("任意关键词", 1).size());
    }

    @Test
    @DisplayName("isReady 恒真 —— 没有 key 可缺")
    void isReadyIsAlwaysTrue() {
        assertTrue(provider().isReady());
        assertEquals("duckduckgo", provider().name());
    }

    @Test
    @DisplayName("HTTP 非 200 抛 IOException")
    void nonOkStatusThrows() {
        server.enqueue(new MockResponse().setResponseCode(429).setBody("rate limited"));

        IOException e = assertThrows(IOException.class, () -> provider().search("任意关键词", 5));
        assertTrue(e.getMessage().contains("429"), "该带上状态码,便于判断是限流还是别的");
    }

    @Test
    @DisplayName("解析出 0 条也抛 IOException —— 绝不返回空列表（失败契约的守门人）")
    void zeroParsedResultsThrowsInsteadOfReturningEmpty() {
        // 结构对但没有 result 锚点 —— 改版后的真实症状就是这样
        server.enqueue(new MockResponse().setBody(
                "<html><body><div class=\"nope\">改版了</div></body></html>"));

        IOException e = assertThrows(IOException.class, () -> provider().search("任意关键词", 5));

        assertTrue(e.getMessage().contains("0 条") || e.getMessage().contains("没有解析到"),
                "该说清是解析不出东西,而不是含糊的失败: " + e.getMessage());
        assertTrue(e.getMessage().contains("searxng") || e.getMessage().contains("/config search"),
                "异常文案必须给出路:改用另三条: " + e.getMessage());
    }

    @Test
    @DisplayName("请求带浏览器 User-Agent 且把关键词编码进查询串")
    void sendsBrowserUserAgentAndEncodedQuery() throws Exception {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        provider().search("中文 关键词", 5);

        RecordedRequest request = server.takeRequest();
        String ua = request.getHeader("User-Agent");
        assertTrue(ua != null && ua.contains("Mozilla"),
                "默认 UA 会被限流得更快,伪装成常见浏览器");
        assertTrue(request.getPath().contains("q="), "关键词该进查询串");
    }
}
