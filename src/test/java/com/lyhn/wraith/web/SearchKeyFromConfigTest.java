package com.lyhn.wraith.web;

import com.lyhn.wraith.config.WraithConfig;
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
 * {@code pickProvider}，key 的来源由 {@code resolveSettings} 决定，两者都可注入。
 */
class SearchKeyFromConfigTest {

    @Test
    @DisplayName("环境/属性/.env 都没有时,回落到 config.json 里的 glm key")
    void fallsBackToConfigJson() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> null,                                  // 环境/属性/.env 一概没有
                null,                                       // search 节也没有
                provider -> "glm".equals(provider) ? "sk-from-gui" : null);

        assertEquals("sk-from-gui", s.glmKey(),
                "桌面里配好的 key 必须能被搜索用上,否则「共享同一份配置」是句空话");
    }

    @Test
    @DisplayName("环境变量优先于 config.json —— 显式覆盖不能被静默吃掉")
    void envWinsOverConfig() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> "sk-from-env", null, provider -> "sk-from-gui");

        assertEquals("sk-from-env", s.glmKey());
    }

    @Test
    @DisplayName("三条路都能从 search 节读到 —— 此前 SERPAPI/SEARXNG 是环境变量专属,那就是不对等本身")
    void everyRouteConsultsSearchSection() {
        // 这条用例此前叫 onlyMappedKeysConsultConfig,断言的是
        // assertNull(resolveKey("SERPAPI_KEY", k -> null, provider -> "x")) ——
        // 即「config 里没有 serpapi 这个概念,查了也是白查」。那句话在 search 节出现之前
        // 是对的,但它同时也是「只有 GLM 零配置」的机制:一条路能读配置文件,两条只能读
        // 环境变量。加了 search 节之后必须反转,否则会把不对等一起搬进新 API。
        WraithConfig.SearchConfig serp = new WraithConfig.SearchConfig();
        serp.setProvider("serpapi");
        serp.setApiKey("sk-fake-serp");
        assertEquals("sk-fake-serp",
                SearchProviderFactory.resolveSettings(k -> null, serp, p -> null).serpKey());

        WraithConfig.SearchConfig searxng = new WraithConfig.SearchConfig();
        searxng.setProvider("searxng");
        searxng.setBaseUrl("http://localhost:8888");
        assertEquals("http://localhost:8888",
                SearchProviderFactory.resolveSettings(k -> null, searxng, p -> null).searxngUrl());

        WraithConfig.SearchConfig zhipu = new WraithConfig.SearchConfig();
        zhipu.setProvider("zhipu");
        zhipu.setApiKey("sk-fake-zhipu");
        assertEquals("sk-fake-zhipu",
                SearchProviderFactory.resolveSettings(k -> null, zhipu, p -> null).glmKey());
    }

    @Test
    @DisplayName("config 里是空串/空白 → 当作没有,不要把空 key 交给 provider")
    void blankConfigValueIsNothing() {
        assertNull(SearchProviderFactory.resolveSettings(k -> null, null, provider -> "   ").glmKey());
        assertNull(SearchProviderFactory.resolveSettings(k -> null, null, provider -> "").glmKey());
    }

    @Test
    @DisplayName("config 查询抛异常也不能把整个搜索链路带崩")
    void configLookupFailureIsNotFatal() {
        // 原先这里还有一行 assertDoesNotThrow(...) —— 与下面这行冗余,且判别力更弱
        // (吞了异常返回垃圾值也能过),删掉。
        assertNull(SearchProviderFactory.resolveSettings(
                k -> null, null, provider -> { throw new IllegalStateException("坏"); }).glmKey());
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
        assertNull(SearchProviderFactory.resolveSettings(k -> null, null, provider -> null).glmKey());
        assertFalse(new ZhipuSearchProvider(null, null).isReady());
    }
}
