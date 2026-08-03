package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SearchProviderFactoryTest {

    @Test
    void explicitProviderOverridesAutoDetect() {
        assertEquals("zhipu", SearchProviderFactory.pickProvider("zhipu", null, "key", "http://localhost"));
        assertEquals("searxng", SearchProviderFactory.pickProvider("searxng", "glm", "key", "http://localhost"));
        assertEquals("serpapi", SearchProviderFactory.pickProvider("serpapi", null, null, "http://localhost"));
    }

    @Test
    void autoSelectsZhipuWhenGlmKeyPresent() {
        // GLM_API_KEY 优先级最高 —— Wraith 主流场景就是 GLM 用户
        assertEquals("zhipu", SearchProviderFactory.pickProvider(null, "glm-key", null, null));
        assertEquals("zhipu", SearchProviderFactory.pickProvider(null, "glm-key", "serp-key", "http://localhost"));
    }

    @Test
    void autoSelectsSerpapiWhenOnlySerpKeyPresent() {
        assertEquals("serpapi", SearchProviderFactory.pickProvider(null, null, "any-key", null));
        assertEquals("serpapi", SearchProviderFactory.pickProvider("", "", "any-key", null));
    }

    @Test
    void autoSelectsSearxngWhenOnlyUrlPresent() {
        assertEquals("searxng", SearchProviderFactory.pickProvider(null, null, null, "http://localhost:8888"));
        assertEquals("searxng", SearchProviderFactory.pickProvider(null, "", "", "http://localhost:8888"));
    }

    @Test
    @DisplayName("什么都没配时返回 unconfigured —— 此前返回 zhipu,那是「未配置」话术偏心 GLM 的机制")
    void fallsBackToUnconfigured() {
        // 这条断言此前是 assertEquals("zhipu", ...)，它正在钉住那个偏心：
        // 占位 provider 是 zhipu ⇒ 中立的三路提示物理上挂在智谱 provider 上 ⇒ 模型张口就说 GLM。
        assertEquals("unconfigured", SearchProviderFactory.pickProvider(null, null, null, null));
    }

    @Test
    void normalizesExplicitToLowercase() {
        assertEquals("searxng", SearchProviderFactory.pickProvider("SEARXNG", null, null, null));
        assertEquals("serpapi", SearchProviderFactory.pickProvider("  SerpAPI  ", null, null, null));
        assertEquals("zhipu", SearchProviderFactory.pickProvider("ZHIPU", null, null, null));
    }
}
