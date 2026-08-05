package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「测试连接」按钮的后端。
 *
 * <p><b>这里刻意不测成功路径</b>：那要么真连外网（测试不该做），要么得给 provider 注入
 * OkHttpClient（{@code SearchProbe} 是按表单值现造 provider 的，没有注入口）。
 * 成功路径的价值本来就在真机上；这里守的是<b>不需要联网也能验的那些约束</b>：
 * 校验短路、未就绪短路、key 抹除、错误截断。
 */
class SearchProbeTest {

    @Test
    @DisplayName("非法配置直接短路 —— 不该为了报「searxng 没填地址」去连一次网")
    void invalidConfigShortCircuitsBeforeAnyRequest() {
        Map<String, Object> out = SearchProbe.probe("searxng", "", "");

        assertEquals(false, out.get("ok"));
        assertTrue(String.valueOf(out.get("error")).contains("SearXNG"), out.toString());
        assertFalse(out.containsKey("latencyMs"), "没发请求就不该有耗时: " + out);
    }

    @Test
    @DisplayName("未就绪时回 provider 自己的提示 —— 那句话比一句通用失败可行动")
    void notReadyReturnsTheProviderHint() {
        // 空 key 的 serpapi / zhipu:isReady() 为 false,不会发任何请求
        for (String provider : new String[]{"serpapi", "zhipu"}) {
            Map<String, Object> out = SearchProbe.probe(provider, "", "");
            assertEquals(false, out.get("ok"), provider + " 空 key 该判未就绪: " + out);
            assertTrue(String.valueOf(out.get("error")).length() > 4, provider + " 要有可读提示: " + out);
            assertFalse(out.containsKey("latencyMs"), provider + " 未就绪不该发请求: " + out);
        }
    }

    @Test
    @DisplayName("回包里带 provider 归一化后的名字 —— 让人确认「实际生效」的是哪个")
    void echoesTheNormalizedProvider() {
        assertEquals("serpapi", SearchProbe.probe("  SerpAPI  ", "", "").get("provider"));
    }

    @Test
    @DisplayName("**回包不含 key** —— 任何路径都不许把凭证带回渲染进程")
    void payloadNeverContainsTheKey() {
        String key = "sk-fake-probe-key-1234567890";
        // 走「duckduckgo 不该给 key」这条校验:有 key 参与,但必须不出现在回包里
        Map<String, Object> out = SearchProbe.probe("duckduckgo", key, "");
        for (Object value : out.values()) {
            assertFalse(String.valueOf(value).contains(key), "回包里出现了 key: " + out);
        }
    }

    @Test
    @DisplayName("错误原文里的 key 被抹掉 —— 有服务端会在 401 消息里回显它")
    void redactsTheKeyFromErrorText() {
        String key = "sk-fake-serp-9876543210";
        String described = SearchProbe.describe(
                new IOException("401 unauthorized for api_key=" + key), key);

        assertFalse(described.contains(key), described);
        assertTrue(described.contains("401"), "原文要留着,那才是能继续查的东西: " + described);
    }

    @Test
    @DisplayName("超长错误被截断 —— 有服务端会把整页 HTML 塞进 4xx 响应体")
    void truncatesEnormousErrorBodies() {
        String described = SearchProbe.describe(new IOException("x".repeat(5000)), null);
        assertTrue(described.length() < 400, "长度 " + described.length());
        assertTrue(described.endsWith("…"), described);
    }

    @Test
    @DisplayName("没有 message 的异常也要说出类名,不能回一句空话")
    void namelessExceptionsStillSayWhatHappened() {
        assertTrue(SearchProbe.describe(new java.net.ConnectException(), null)
                .contains("ConnectException"));
    }

    // ── effectiveKey:必须与 apply 的「空=保留旧」严格一致 ────────────────

    @Test
    @DisplayName("表单填了就用表单的")
    void formKeyWins() {
        assertEquals("sk-new", SearchProbe.effectiveKey("serpapi", "sk-old", "serpapi", " sk-new "));
    }

    @Test
    @DisplayName("表单空 + 同一个 provider = 沿用已存 —— 否则「测试连接」永远 401 而保存却是好的")
    void blankFormKeyInheritsWhenProviderUnchanged() {
        assertEquals("sk-old", SearchProbe.effectiveKey("serpapi", "sk-old", "serpapi", ""));
        assertEquals("sk-old", SearchProbe.effectiveKey(" SerpAPI ", "sk-old", "serpapi", null));
    }

    @Test
    @DisplayName("**换了 provider 就不继承** —— 同 apply:继承会把 SerpAPI 的 key 发给智谱")
    void blankFormKeyDoesNotInheritAcrossProviders() {
        assertEquals("", SearchProbe.effectiveKey("serpapi", "sk-old-serp", "zhipu", ""));
    }

    @Test
    void nullsAreSafe() {
        assertEquals("", SearchProbe.effectiveKey(null, null, null, null));
    }
}
