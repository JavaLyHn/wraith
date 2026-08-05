package com.lyhn.wraith.tool;

import com.lyhn.wraith.web.SearchProvider;
import com.lyhn.wraith.web.SearchResult;
import com.lyhn.wraith.web.UnconfiguredSearchProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 搜索后端的<b>实时</b>状态查询 —— 桌面「能力概览」那个黄色「需配置」角标的数据源。
 *
 * <p><b>症状</b>：用户已经配好搜索后端、agent 也确实搜到了 GitHub 内容，面板上那张
 * 「网页搜索与抓取」卡片却仍然挂着黄色「需配置」和一整段「搜索需四者之一…」。
 *
 * <p><b>根因</b>：那个角标是<b>静态标注</b>（{@code pluginShowcase.ts} 里写死的
 * {@code requires} 字段）。当初刻意选静态，理由是「实时探测一旦探不到就会反过来误报」——
 * 但代价是配好了也永远显示需配置，即<b>反方向的误报</b>，而且是每个配好的用户都会看到。
 *
 * <p><b>纪律</b>：状态必须由 <b>agent 真正会用的那个 provider 对象</b>回答
 * （{@code searchProvider()} 那一个），不另起一套判断逻辑 —— 否则面板说「就绪」而
 * agent 说「未配置」，比现在更糟。
 */
class SearchStatusTest {

    private static SearchProvider stub(String name, boolean ready) {
        return new SearchProvider() {
            @Override public String name() { return name; }
            @Override public boolean isReady() { return ready; }
            @Override public String unavailableHint() { return "假 provider 的提示"; }
            @Override public List<SearchResult> search(String query, int topK) { return List.of(); }
        };
    }

    @Test
    @DisplayName("配好了就回 ready:true 并说出用的是哪个后端")
    void configuredBackendReportsReady() {
        ToolRegistry registry = new ToolRegistry();
        registry.setSearchProviderForTest(stub("searxng", true));

        Map<String, Object> status = registry.searchStatus();
        assertEquals(true, status.get("ready"));
        assertEquals("searxng", status.get("provider"));
    }

    @Test
    @DisplayName("什么都没配就回 ready:false —— 载体是 UnconfiguredSearchProvider")
    void unconfiguredReportsNotReady() {
        ToolRegistry registry = new ToolRegistry();
        registry.setSearchProviderForTest(new UnconfiguredSearchProvider());

        Map<String, Object> status = registry.searchStatus();
        assertEquals(false, status.get("ready"));
        assertNotNull(status.get("provider"));
    }

    @Test
    @DisplayName("显式选了 zhipu 却没给 key:仍然是 false（别只看「选了哪个」就说就绪）")
    void explicitProviderWithoutKeyIsNotReady() {
        ToolRegistry registry = new ToolRegistry();
        registry.setSearchProviderForTest(stub("zhipu", false));

        assertEquals(false, registry.searchStatus().get("ready"));
    }

    @Test
    @DisplayName("状态问的就是缓存里那一个 provider:换掉它,状态跟着变(不是快照)")
    void statusFollowsTheLiveProvider() {
        ToolRegistry registry = new ToolRegistry();

        registry.setSearchProviderForTest(new UnconfiguredSearchProvider());
        assertEquals(false, registry.searchStatus().get("ready"));

        // 用户写了配置 → 失效 → 换成配好的后端。面板不重启也必须跟上。
        registry.setSearchProviderForTest(stub("serpapi", true));
        Map<String, Object> after = registry.searchStatus();
        assertEquals(true, after.get("ready"));
        assertEquals("serpapi", after.get("provider"));
    }

    /**
     * <b>判据从「字段名」改成了「值的类型」。</b>
     *
     * <p>原来是「字段名不许含 key/token/secret」。桌面端要能配搜索后端之后，回包必须带一个
     * {@code hasKey} 布尔 —— 表单不回填 key，但它得能区分「没配过」和「配过但不给看」，
     * 否则表单显示成空的、用户以为清空了，一保存就把好 key 覆盖没了。
     * （{@code hasKey} 这个名字沿用 {@code embeddingGet} 的既有约定。）
     *
     * <p>红线本身<b>没有放松</b>：真正的 key 是<b>字符串</b>。所以现在要求凡是名字里带
     * key/token/secret 的字段，值必须是 {@code Boolean} —— 一个布尔携带不了密钥，
     * 而任何字符串都可能是。按名字禁止只能挡住"叫得老实"的泄漏；按类型能挡住全部。
     */
    @Test
    @DisplayName("回包里的凭证类字段只能是布尔 —— 真 key 是字符串,布尔携带不了密钥")
    void statusNeverCarriesCredentials() {
        ToolRegistry registry = new ToolRegistry();
        registry.setSearchProviderForTest(stub("serpapi", true));

        Map<String, Object> status = registry.searchStatus();
        for (Map.Entry<String, Object> e : status.entrySet()) {
            String lower = e.getKey().toLowerCase(java.util.Locale.ROOT);
            if (lower.contains("key") || lower.contains("token") || lower.contains("secret")) {
                assertTrue(e.getValue() instanceof Boolean,
                        "凭证类字段只能回布尔,不能回内容: " + e.getKey() + " = " + e.getValue());
            }
        }
        assertTrue(status.keySet().containsAll(java.util.Set.of("provider", "ready")),
                "至少要有 provider 与 ready: " + status.keySet());
    }
}
