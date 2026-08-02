package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 桌面 GUI 里配好的 GLM key 要能被 web_search 用上。
 *
 * <p><b>起因</b>：用户看着插件面板上「网页搜索与抓取 · 已内置 · 无需配置即可调用」，
 * 实际一用就报「web_search 不可用，需要配置 GLM_API_KEY」，于是问
 * 「为什么都不可用，不是都内置了吗」。
 *
 * <p>查下来 {@link SearchProviderFactory} 的取值链是
 * <b>环境变量 → 系统属性 → ./.env → ~/.env</b>，<b>从不读 {@code ~/.wraith/config.json}</b>。
 * 而桌面「Provider 配置」面板保存的就是 config.json。也就是说：
 * <b>在 GUI 里配好 GLM，web_search 依然瞎。</b>
 *
 * <p>这跟文档里到处写的「CLI 与桌面共享同一份配置」直接冲突——共享的只是推理用的 key，
 * 搜索这条支路自己另开了一套取值规则，而且没人说过。
 *
 * <p>这里只测**取值优先级**这一件事，不碰真实网络：provider 的选择是纯函数
 * {@code pickProvider}，key 的来源由 {@code resolveKey} 决定，两者都可注入。
 */
class SearchKeyFromConfigTest {

    @Test
    @DisplayName("环境/属性/.env 都没有时,回落到 config.json 里的 glm key")
    void fallsBackToConfigJson() {
        String key = SearchProviderFactory.resolveKey(
                "GLM_API_KEY",
                k -> null,                                  // 环境/属性/.env 一概没有
                provider -> "glm".equals(provider) ? "sk-from-gui" : null);

        assertEquals("sk-from-gui", key,
                "桌面里配好的 key 必须能被搜索用上,否则「共享同一份配置」是句空话");
    }

    @Test
    @DisplayName("环境变量优先于 config.json —— 显式覆盖不能被静默吃掉")
    void envWinsOverConfig() {
        String key = SearchProviderFactory.resolveKey(
                "GLM_API_KEY",
                k -> "sk-from-env",
                provider -> "sk-from-gui");

        assertEquals("sk-from-env", key);
    }

    @Test
    @DisplayName("只有能映射到 provider 的 key 才查 config;SERPAPI/SEARXNG 仍是环境变量专属")
    void onlyMappedKeysConsultConfig() {
        // config 里没有 "serpapi" 这个 provider 概念,查了也是白查 —— 不该假装它有
        assertNull(SearchProviderFactory.resolveKey("SERPAPI_KEY", k -> null, provider -> "x"));
        assertNull(SearchProviderFactory.resolveKey("SEARXNG_URL", k -> null, provider -> "x"));
        assertNull(SearchProviderFactory.resolveKey("SEARCH_PROVIDER", k -> null, provider -> "x"));
    }

    @Test
    @DisplayName("config 里是空串/空白 → 当作没有,不要把空 key 交给 provider")
    void blankConfigValueIsNothing() {
        assertNull(SearchProviderFactory.resolveKey("GLM_API_KEY", k -> null, provider -> "   "));
        assertNull(SearchProviderFactory.resolveKey("GLM_API_KEY", k -> null, provider -> ""));
    }

    @Test
    @DisplayName("config 查询抛异常也不能把整个搜索链路带崩")
    void configLookupFailureIsNotFatal() {
        assertDoesNotThrow(() -> SearchProviderFactory.resolveKey(
                "GLM_API_KEY",
                k -> null,
                provider -> { throw new IllegalStateException("配置文件坏了"); }));
        assertNull(SearchProviderFactory.resolveKey(
                "GLM_API_KEY", k -> null, provider -> { throw new IllegalStateException("坏"); }));
    }

    @Test
    @DisplayName("有了 config 里的 glm key,自动选型就该落到 zhipu 且 isReady")
    void configKeyMakesZhipuReady() {
        assertEquals("zhipu", SearchProviderFactory.pickProvider(null, "sk-from-gui", null, null));
        assertTrue(new ZhipuSearchProvider("sk-from-gui", null).isReady(),
                "拿到 key 之后 provider 必须自认就绪,否则前面白修");
    }

    @Test
    @DisplayName("确实什么都没有时仍报未就绪 —— 不许假装可用")
    void stillNotReadyWithNothing() {
        assertNull(SearchProviderFactory.resolveKey("GLM_API_KEY", k -> null, provider -> null));
        assertFalse(new ZhipuSearchProvider(null, null).isReady());
    }
}
