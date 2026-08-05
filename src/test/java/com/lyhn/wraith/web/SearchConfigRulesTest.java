package com.lyhn.wraith.web;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 搜索后端配置的规则 —— <b>CLI 与桌面共用这一份</b>。
 *
 * <p>起因：用户实测发现桌面端只有 {@code config.getSearch} 没有 {@code config.setSearch}，
 * 「网页搜索与抓取」卡片只能指着 CLI 的 {@code /config search}。补写入口时，
 * 规则若在 app-server 那侧重写一遍，两条路会漂 —— 漂的方向恰好是
 * 「桌面能存进一个 CLI 认为非法的配置」。
 */
class SearchConfigRulesTest {

    @Test
    @DisplayName("provider 必需 —— 一个 apiKey 字段服务两家,归属不可猜")
    void providerIsRequired() {
        assertEquals(SearchConfigRules.Violation.PROVIDER_REQUIRED,
                SearchConfigRules.check(null, "sk-fake", null));
        assertEquals(SearchConfigRules.Violation.PROVIDER_REQUIRED,
                SearchConfigRules.check("   ", "sk-fake", null));
    }

    @Test
    void rejectsUnknownProvider() {
        assertEquals(SearchConfigRules.Violation.UNKNOWN_PROVIDER,
                SearchConfigRules.check("google", null, null));
    }

    @Test
    @DisplayName("searxng 没地址就不成立 —— 自托管实例没有公共地址可默认")
    void searxngNeedsBaseUrl() {
        assertEquals(SearchConfigRules.Violation.SEARXNG_NEEDS_BASE_URL,
                SearchConfigRules.check("searxng", null, null));
        assertNull(SearchConfigRules.check("searxng", null, "http://localhost:8888"));
    }

    @Test
    @DisplayName("duckduckgo 多给参数要报错 —— 静默吞掉会让用户以为 key 生效了")
    void duckDuckGoTakesNothing() {
        assertEquals(SearchConfigRules.Violation.DUCKDUCKGO_TAKES_NOTHING,
                SearchConfigRules.check("duckduckgo", "sk-fake", null));
        assertEquals(SearchConfigRules.Violation.DUCKDUCKGO_TAKES_NOTHING,
                SearchConfigRules.check("duckduckgo", null, "http://x"));
        assertNull(SearchConfigRules.check("duckduckgo", null, null));
    }

    @Test
    @DisplayName("**空白等于没给** —— 表单的空输入框与命令行里没写这个旗标必须等价")
    void blankCountsAsAbsent() {
        // 桌面表单一定会发 "" 而不是 null;若把 "" 当成「给了」,duckduckgo 就永远存不进去
        assertNull(SearchConfigRules.check("duckduckgo", "", ""));
        assertNull(SearchConfigRules.check("duckduckgo", "  ", "  "));
        assertEquals(SearchConfigRules.Violation.SEARXNG_NEEDS_BASE_URL,
                SearchConfigRules.check("searxng", "", ""));
    }

    @Test
    @DisplayName("provider 大小写与空白不敏感")
    void normalizesProvider() {
        assertNull(SearchConfigRules.check("  SerpAPI ", "sk-fake", null));
        assertEquals("serpapi", SearchConfigRules.normalize("  SerpAPI "));
        assertEquals("", SearchConfigRules.normalize(null));
    }

    // ── apply:落盘语义 ────────────────────────────────────────────────────

    @Test
    @DisplayName("空 key = 保留旧值 —— 表单不回填 key,空框必须是「别动」")
    void blankKeyKeepsExistingWhenProviderUnchanged() {
        WraithConfig.SearchConfig target = new WraithConfig.SearchConfig();
        target.setProvider("serpapi");
        target.setApiKey("sk-old-serp");

        SearchConfigRules.apply(target, "serpapi", "", "");

        assertEquals("sk-old-serp", target.getApiKey(), "同一个 provider,空框不该清掉已存 key");
    }

    @Test
    @DisplayName("**换 provider 时不继承旧 key** —— 否则就是把 SerpAPI 的 key 发给智谱")
    void switchingProviderDoesNotInheritTheOldKey() {
        WraithConfig.SearchConfig target = new WraithConfig.SearchConfig();
        target.setProvider("serpapi");
        target.setApiKey("sk-old-serp");

        SearchConfigRules.apply(target, "zhipu", "", "");

        assertEquals("zhipu", target.getProvider());
        assertNull(target.getApiKey(),
                "沿用旧 key 会把 SerpAPI 的 key 发给智谱 —— 那只会得到一个 401,用户以为 key 坏了");
    }

    @Test
    @DisplayName("换 provider 也不继承旧 baseUrl —— searxng 的地址对别家毫无意义")
    void switchingProviderDoesNotInheritTheOldBaseUrl() {
        WraithConfig.SearchConfig target = new WraithConfig.SearchConfig();
        target.setProvider("searxng");
        target.setBaseUrl("http://localhost:8888");

        SearchConfigRules.apply(target, "duckduckgo", "", "");

        assertNull(target.getBaseUrl());
    }

    @Test
    @DisplayName("清空用 null 而不是空串 —— 空串在 config.json 里读起来像「配过一个空 key」")
    void clearsWithNullNotEmptyString() {
        WraithConfig.SearchConfig target = new WraithConfig.SearchConfig();
        target.setProvider("serpapi");
        target.setApiKey("sk-old");

        SearchConfigRules.apply(target, "searxng", "", "http://localhost:8888");

        assertNull(target.getApiKey());
        assertEquals("http://localhost:8888", target.getBaseUrl());
    }

    @Test
    void trimsWhatItWrites() {
        WraithConfig.SearchConfig target = new WraithConfig.SearchConfig();
        SearchConfigRules.apply(target, " SERPAPI ", "  sk-new  ", "  http://x  ");
        assertEquals("serpapi", target.getProvider());
        assertEquals("sk-new", target.getApiKey());
        assertEquals("http://x", target.getBaseUrl());
    }

    @Test
    @DisplayName("表单措辞不提旗标,CLI 那套才提 —— 规则一份,措辞两套")
    void formMessagesDoNotMentionCommandLineFlags() {
        for (SearchConfigRules.Violation v : SearchConfigRules.Violation.values()) {
            String message = SearchConfigRules.formMessage(v, "google");
            assertTrue(message != null && !message.isBlank(), v + " 要有话说");
            assertTrue(!message.contains("--"),
                    "表单里没有旗标,不该说 --xxx: " + v + " -> " + message);
        }
    }
}
