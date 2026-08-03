package com.lyhn.wraith.web;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 三条搜索路的取值链必须对等 —— 都能从 config.json 的 search 节读到。
 *
 * <p>此前只有 GLM_API_KEY 能回落 config.json（因为它蹭的是 providers.glm.apiKey），
 * SERPAPI_KEY / SEARXNG_URL 在 config.json 里没有对应概念，只能来自环境变量。
 * 「只有 GLM 零配置」的全部机制就是这个取值链不对等，不是搜索代码偏爱智谱。
 *
 * <p>全部走注入入口：不碰真实环境变量、不碰真实 ~/.wraith/config.json。
 */
class SearchConfigResolutionTest {

    private static WraithConfig.SearchConfig search(String provider, String apiKey, String baseUrl) {
        WraithConfig.SearchConfig s = new WraithConfig.SearchConfig();
        s.setProvider(provider);
        s.setApiKey(apiKey);
        s.setBaseUrl(baseUrl);
        return s;
    }

    /** 环境侧一概没有。 */
    private static final java.util.function.Function<String, String> NO_ENV = k -> null;
    /** providers.* 侧一概没有。 */
    private static final java.util.function.Function<String, String> NO_PROVIDER_KEY = p -> null;

    @Test
    @DisplayName("searxng 的 baseUrl 能从 search 节读到（此前只能来自 SEARXNG_URL 环境变量）")
    void searxngBaseUrlComesFromSearchSection() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                NO_ENV, search("searxng", null, "http://localhost:8888"), NO_PROVIDER_KEY);

        assertEquals("searxng", s.provider());
        assertEquals("http://localhost:8888", s.searxngUrl());
    }

    @Test
    @DisplayName("serpapi 的 key 能从 search 节读到，但仅当 provider 明确是 serpapi")
    void serpKeyComesFromSearchSectionOnlyWhenProviderIsExplicit() {
        SearchProviderFactory.SearchSettings explicit = SearchProviderFactory.resolveSettings(
                NO_ENV, search("serpapi", "sk-fake-serp", null), NO_PROVIDER_KEY);
        assertEquals("sk-fake-serp", explicit.serpKey());

        // provider 为空时不猜 apiKey 属于谁 —— 猜错会把 SerpAPI 的 key 发给智谱
        SearchProviderFactory.SearchSettings ambiguous = SearchProviderFactory.resolveSettings(
                NO_ENV, search(null, "sk-fake-serp", null), NO_PROVIDER_KEY);
        assertNull(ambiguous.serpKey(), "provider 未明确时 apiKey 不该被当成 serpapi 的");
        assertNull(ambiguous.glmKey(), "provider 未明确时 apiKey 也不该被当成 zhipu 的");
    }

    @Test
    @DisplayName("zhipu 的 key 能从 search 节读到，且 providers.glm.apiKey 的既有回落不被破坏")
    void zhipuKeyFromSearchSectionAndLegacyGlmFallbackBothWork() {
        SearchProviderFactory.SearchSettings fromSearch = SearchProviderFactory.resolveSettings(
                NO_ENV, search("zhipu", "sk-fake-from-search", null), NO_PROVIDER_KEY);
        assertEquals("sk-fake-from-search", fromSearch.glmKey());

        // search 节没有 apiKey 时，回落 providers.glm.apiKey —— 这是既有行为，必须保留
        SearchProviderFactory.SearchSettings fromProviders = SearchProviderFactory.resolveSettings(
                NO_ENV, null, p -> "glm".equals(p) ? "sk-fake-from-providers" : null);
        assertEquals("sk-fake-from-providers", fromProviders.glmKey());

        // search 节更具体，胜出
        SearchProviderFactory.SearchSettings both = SearchProviderFactory.resolveSettings(
                NO_ENV, search("zhipu", "sk-fake-from-search", null),
                p -> "glm".equals(p) ? "sk-fake-from-providers" : null);
        assertEquals("sk-fake-from-search", both.glmKey());
    }

    @Test
    @DisplayName("env 优先于 config 的 search 节")
    void envWinsOverSearchSection() {
        java.util.function.Function<String, String> env = k -> switch (k) {
            case "SEARCH_PROVIDER" -> "serpapi";
            case "SEARXNG_URL" -> "http://from-env:8888";
            case "SERPAPI_KEY" -> "sk-fake-env-serp";
            default -> null;
        };

        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                env, search("searxng", "sk-fake-config-serp", "http://from-config:8888"), NO_PROVIDER_KEY);

        assertEquals("serpapi", s.provider());
        assertEquals("http://from-env:8888", s.searxngUrl());
        assertEquals("sk-fake-env-serp", s.serpKey());
    }

    @Test
    @DisplayName("空白与空串当作没有配")
    void blankValuesCountAsAbsent() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> "   ", search("  ", "  ", "  "), p -> "   ");

        assertNull(s.provider());
        assertNull(s.searxngUrl());
        assertNull(s.serpKey());
        assertNull(s.glmKey());
    }

    @Test
    @DisplayName("search 节整节缺失时回落 env，不抛异常")
    void missingSearchSectionFallsBackToEnv() {
        java.util.function.Function<String, String> env = k -> "SEARXNG_URL".equals(k)
                ? "http://localhost:8888" : null;

        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(env, null, NO_PROVIDER_KEY);

        assertEquals("http://localhost:8888", s.searxngUrl());
        assertNull(s.provider());
    }

    @Test
    @DisplayName("providers 侧读取抛异常时当作「没有」，不把搜索链路带崩（沿用 resolveKey 的吞异常约定）")
    void providerLookupExceptionIsSwallowed() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                NO_ENV, null, p -> { throw new RuntimeException("config.json 坏了"); });

        assertNull(s.glmKey(), "配置文件坏了该退化成「未配置」，用户看到可行动的提示；一个堆栈不是");
    }

    @Test
    @DisplayName("ZHIPU_SEARCH_ENGINE 仍是环境变量专属（config.json 里没有对应概念）")
    void zhipuEngineStaysEnvOnly() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> "ZHIPU_SEARCH_ENGINE".equals(k) ? "search_pro" : null, null, NO_PROVIDER_KEY);

        assertEquals("search_pro", s.zhipuEngine());
    }
}
