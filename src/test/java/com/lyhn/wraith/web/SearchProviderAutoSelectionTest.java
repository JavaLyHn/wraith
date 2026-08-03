package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * D6 核心约束的守门人：<b>自动选择链永远不返回 duckduckgo</b>。
 *
 * <p>DDG 靠抓 HTML，改版或限流都会让它碎。做成「默认」会让搜索时好时坏，比明确报
 * 「未配置」更糟——一个静默返回垃圾的工具会让模型拿着空结果继续编。把可达性收窄到
 * 只有显式指定一条路之后，它就<b>无法静默降低任何人的搜索质量</b>，而「零 key 能搜」
 * 的好处保住了。这个测试就是那道收窄的门。
 *
 * <p>判别力自证：把自动链里任何一条改成回落 duckduckgo，本测试变红。
 */
class SearchProviderAutoSelectionTest {

    @Test
    @DisplayName("三个自动输入的全部 8 种空/非空组合，都不产生 duckduckgo")
    void autoSelectionNeverYieldsDuckDuckGo() {
        String[] glmKeys = {null, "sk-fake-glm"};
        String[] serpKeys = {null, "sk-fake-serp"};
        String[] searxngUrls = {null, "http://localhost:8888"};

        int combinations = 0;
        for (String glm : glmKeys) {
            for (String serp : serpKeys) {
                for (String url : searxngUrls) {
                    String chosen = SearchProviderFactory.pickProvider(null, glm, serp, url);
                    assertNotEquals("duckduckgo", chosen,
                            "自动链不该产出 duckduckgo (glm=" + glm + ", serp=" + serp + ", url=" + url + ")");
                    combinations++;
                }
            }
        }
        assertEquals(8, combinations, "三个布尔维度应当穷举 8 种组合");
    }

    @Test
    @DisplayName("空串与空白的 explicit 也走自动链，同样不产生 duckduckgo")
    void blankExplicitStillGoesThroughAutoSelection() {
        assertNotEquals("duckduckgo", SearchProviderFactory.pickProvider("", null, null, null));
        assertNotEquals("duckduckgo", SearchProviderFactory.pickProvider("   ", "sk-fake-glm", null, null));
    }

    @Test
    @DisplayName("显式指定时确实拿得到 duckduckgo，且 create 派发到那个类")
    void explicitDuckDuckGoIsReachable() {
        assertEquals("duckduckgo", SearchProviderFactory.pickProvider("duckduckgo", null, null, null));
        assertEquals("duckduckgo", SearchProviderFactory.pickProvider("  DuckDuckGo  ", null, null, null));

        SearchProvider provider = SearchProviderFactory.create(
                new SearchProviderFactory.SearchSettings("duckduckgo", null, null, null, null));
        assertEquals("duckduckgo", provider.name());
        assertEquals(DuckDuckGoSearchProvider.class, provider.getClass());
    }
}
