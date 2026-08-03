package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「未配置」这句话此前由 ZhipuSearchProvider 代言 —— pickProvider 在什么都没配时返回
 * "zhipu" 作占位，于是那条中立的「三条路都给你」的提示物理上挂在智谱 provider 上。
 * 用户截图里模型开口就提 GLM，原因就是它读到的可用信息是智谱 provider 在说话。
 *
 * <p>检测函数全部注入：不真查 PATH、不真连网。
 */
class UnconfiguredHintTest {

    private static UnconfiguredSearchProvider provider(boolean docker, boolean port) {
        return new UnconfiguredSearchProvider(() -> docker, () -> port);
    }

    @Test
    @DisplayName("载体是 unconfigured 而不是 zhipu")
    void nameIsUnconfigured() {
        assertEquals("unconfigured", provider(false, false).name());
        assertFalse(provider(false, false).isReady());
    }

    @Test
    @DisplayName("8888 有服务在听时，直接给可粘贴的 /config search")
    void portListeningBranchGivesConfigCommand() {
        String hint = provider(true, true).unavailableHint();

        assertTrue(hint.contains("localhost:8888"), "该点名检测到的端口");
        assertTrue(hint.contains("/config search --provider searxng --base-url http://localhost:8888"),
                "该给可直接粘贴的命令");
        assertFalse(hint.contains("docker run"), "已经有服务在听了,不该再让用户起一个容器");
    }

    @Test
    @DisplayName("有 docker 但 8888 空着时，给 docker run 再给 /config search")
    void dockerPresentBranchGivesDockerRunThenConfig() {
        String hint = provider(true, false).unavailableHint();

        assertTrue(hint.contains("docker run --rm -p 8888:8888 searxng/searxng"));
        assertTrue(hint.contains("/config search --provider searxng --base-url http://localhost:8888"));
        assertTrue(hint.contains("免费"), "该点明这条不要钱、不需要任何 key");
    }

    @Test
    @DisplayName("没有 docker 时三条路都说清，且不推荐任何一条为默认")
    void noDockerBranchListsAllThreeWithoutPickingAFavourite() {
        String hint = provider(false, false).unavailableHint();

        assertTrue(hint.contains("SEARXNG"), "SearXNG 那条要在");
        assertTrue(hint.contains("SERPAPI_KEY"), "SerpAPI 那条要在");
        assertTrue(hint.contains("GLM_API_KEY"), "智谱那条要在（作为三选一之一）");
        assertFalse(hint.contains("推荐 GLM"), "GLM 只能是三选一之一,不能是推荐");
        assertFalse(hint.contains("默认推荐"), "不该给任何一条贴「默认推荐」");
    }

    @Test
    @DisplayName("两条兜底出口都在，各自带警示")
    void bothFallbackExitsArePresentWithWarnings() {
        String hint = provider(false, false).unavailableHint();

        assertTrue(hint.contains("浏览器"), "浏览器那条兜底要在");
        assertTrue(hint.contains("Node"), "浏览器那条要说清它要 Node/npx");
        assertTrue(hint.contains("duckduckgo"), "duckduckgo 那条兜底要在");
        assertTrue(hint.contains("限流") || hint.contains("改版"),
                "duckduckgo 那条必须带不稳定警示,不能读成推荐");
    }

    @Test
    @DisplayName("两条兜底排在三条主路之后 —— 断言下标顺序，不是断言「包含」")
    void fallbackExitsComeAfterTheThreeMainPaths() {
        // 只断言「包含」的话,把兜底放到开头也能过 —— 那正是要防的失败:
        // 一条不稳定的应急路排在三条正路前面,读起来就是推荐。
        String hint = provider(false, false).unavailableHint();

        int lastMainPath = Math.max(Math.max(hint.indexOf("GLM_API_KEY"), hint.indexOf("SERPAPI_KEY")),
                hint.indexOf("SEARXNG"));
        int firstFallback = Math.min(indexOrMax(hint, "浏览器"), indexOrMax(hint, "duckduckgo"));

        assertTrue(lastMainPath >= 0 && firstFallback > lastMainPath,
                "兜底出口(下标 " + firstFallback + ")必须排在三条主路(最后一条在 "
                        + lastMainPath + ")之后");
    }

    private static int indexOrMax(String haystack, String needle) {
        int i = haystack.indexOf(needle);
        return i < 0 ? Integer.MAX_VALUE : i;
    }

    @Test
    @DisplayName("search() 抛出的异常带的就是这份提示")
    void searchThrowsWithTheHint() {
        UnconfiguredSearchProvider p = provider(false, false);

        java.io.IOException e = assertThrows(java.io.IOException.class, () -> p.search("任意关键词", 5));
        assertEquals(p.unavailableHint(), e.getMessage());
    }
}
