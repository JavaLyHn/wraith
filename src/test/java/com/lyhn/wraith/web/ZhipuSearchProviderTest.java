package com.lyhn.wraith.web;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 注意：ZhipuSearchProvider 的真实 endpoint 是 hardcoded 在常量里的，
 * 这里通过包构造器注入自定义 OkHttpClient + MockWebServer，
 * 利用 OkHttp 的 Interceptor 重写请求 URL 来命中 mock 服务。
 */
class ZhipuSearchProviderTest {

    private MockWebServer server;
    private OkHttpClient client;

    @BeforeEach
    void setup() throws IOException {
        server = new MockWebServer();
        server.start();
        client = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS)
                // 把所有请求重写到 mock server，绕开 hardcoded endpoint
                .addInterceptor(chain -> {
                    var original = chain.request();
                    assertEquals("https://open.bigmodel.cn/api/paas/v4/web_search",
                            original.url().toString());
                    var newUrl = server.url("/api/paas/v4/web_search");
                    return chain.proceed(original.newBuilder().url(newUrl).build());
                })
                .build();
    }

    @AfterEach
    void shutdown() throws IOException {
        server.shutdown();
    }

    @Test
    void readyWhenApiKeyConfigured() {
        assertTrue(new ZhipuSearchProvider("any-key").isReady());
        assertFalse(new ZhipuSearchProvider("").isReady());
        assertFalse(new ZhipuSearchProvider(null).isReady());
    }

    @Test
    void parsesSuccessResponse() throws IOException, InterruptedException {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""
                        {
                          "search_result": [
                            {
                              "title": "技术派 - PaiCoding",
                              "link": "https://paicoding.com",
                              "content": "一个开源 Java 学习社区",
                              "publish_date": "2026-01-01"
                            },
                            {
                              "title": "Wraith 教程",
                              "link": "https://paicoding.com/article/wraith-cli",
                              "content": "从零打造 Java Agent CLI"
                            }
                          ],
                          "request_id": "abc-123"
                        }
                        """));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("test-key", "search_pro", client);
        List<SearchResult> results = provider.search("技术派", 5);

        assertEquals(2, results.size());
        assertEquals(1, results.get(0).position());
        assertEquals("技术派 - PaiCoding", results.get(0).title());
        assertEquals("paicoding.com", results.get(0).source());
        assertEquals("https://paicoding.com/article/wraith-cli", results.get(1).url());

        // 验证请求格式
        RecordedRequest req = server.takeRequest();
        assertEquals("POST", req.getMethod());
        assertEquals("Bearer test-key", req.getHeader("Authorization"));
        String body = req.getBody().readUtf8();
        assertTrue(body.contains("\"search_engine\":\"search_pro\""), body);
        assertTrue(body.contains("\"search_query\":\"技术派\""), body);
        assertTrue(body.contains("\"count\":5"), body);
    }

    @Test
    void unauthorizedThrowsClearMessage() {
        server.enqueue(new MockResponse().setResponseCode(401).setBody("{\"error\":\"invalid key\"}"));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("bad-key", "search_std", client);
        IOException ex = assertThrows(IOException.class, () -> provider.search("test", 5));
        assertTrue(ex.getMessage().contains("无效或已过期"));
    }

    @Test
    void serverErrorIncludesBodyPreview() {
        server.enqueue(new MockResponse().setResponseCode(500).setBody("{\"error\":\"内部错误\"}"));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("test-key", "search_std", client);
        IOException ex = assertThrows(IOException.class, () -> provider.search("test", 5));
        assertTrue(ex.getMessage().contains("500"));
    }

    @Test
    void emptyResultArrayReturnsEmptyList() throws IOException {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"search_result\":[],\"request_id\":\"x\"}"));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("test-key", "search_std", client);
        List<SearchResult> results = provider.search("无结果查询", 5);
        assertTrue(results.isEmpty());
    }

    @Test
    void malformedFieldsAreSkipped() throws IOException {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""
                        {
                          "search_result": [
                            {"title": "", "link": "", "content": ""},
                            {"title": "有效", "link": "https://example.com", "content": "正文"}
                          ]
                        }
                        """));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("test-key", "search_std", client);
        List<SearchResult> results = provider.search("test", 10);

        // 空标题且空内容的项应被跳过
        assertEquals(1, results.size());
        assertEquals("有效", results.get(0).title());
        assertEquals(1, results.get(0).position(), "position 应连续编号，跳过的不占位");
    }

    @Test
    void invalidEngineFallsBackToDefault() throws IOException, InterruptedException {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"search_result\":[]}"));

        ZhipuSearchProvider provider = new ZhipuSearchProvider("test-key", "not_an_engine", client);
        provider.search("test", 5);

        RecordedRequest req = server.takeRequest();
        String body = req.getBody().readUtf8();
        assertTrue(body.contains("\"search_engine\":\"search_std\""),
                "未知 engine 应回退到 search_std: " + body);
    }

    @Test
    void searchWithoutKeyThrows() {
        ZhipuSearchProvider provider = new ZhipuSearchProvider("", "search_std", client);
        IOException ex = assertThrows(IOException.class, () -> provider.search("test", 5));
        // 断言的是意图而不是措辞:这条消息必须**可行动**,且不能让用户以为搜索没救了。
        //
        // 演化史(第三版):①最初断言含「API Key」四个字 —— 钉死措辞,提示改好一点就红;
        // ②改成断言三条路的环境变量名都在 —— 但那把「中立的三路指引」钉在了 Zhipu 身上,
        // 而那正是 D2 要修的错位:占位 provider 是 zhipu ⇒ 那句话由智谱代言 ⇒ 模型张口说 GLM。
        // ③现在:三路指引搬去了 UnconfiguredSearchProvider(见 UnconfiguredHintTest),
        // 这里只在用户**显式选了 zhipu 却没给 key** 时出现,所以断言收窄成
        // 「说清 zhipu 自己要什么」+「指出还有别的后端可选」。
        String msg = ex.getMessage();
        assertTrue(msg.contains("GLM_API_KEY"), msg);
        assertTrue(msg.contains("serpapi") && msg.contains("searxng"),
                "不能让显式选了 zhipu 的用户以为只有这一条路: " + msg);
    }
}
