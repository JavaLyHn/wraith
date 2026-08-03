package com.lyhn.wraith.web;

import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * web_search 的「说明」与「未配置提示」必须说真话。
 *
 * <p><b>起因</b>：用户问「这个 GLM key 是哪来的？我不一定会配 GLM key，
 * 用我聊天的 LLM provider 不行吗？必须设了 GLM key 才能用 MCP 吗？」
 *
 * <p>查代码时发现两处**事实错误**，而且都会直接误导人：
 *
 * <p><b>① 工具描述过时。</b> 它写着「支持 SerpAPI（默认）和 SearXNG（自托管）两种 provider」——
 * 但 {@link SearchProviderFactory#pickProvider} 的默认是 <b>zhipu</b>，而且一共有<b>三个</b> provider，
 * 描述里连 zhipu 都没提。这个字符串进的是模型的 tool schema，
 * 所以**模型是照着它答的**：用户截图里那句「需要配置 GLM_API_KEY 或其他搜索 provider
 * （SerpAPI / SearXNG）」正是「unavailableHint 提到 GLM」+「工具描述提到 SerpAPI/SearXNG」拼出来的。
 *
 * <p>顺带：provider 是谁**对模型毫无用处**——它不选 provider，也不该关心。
 * 把配置细节塞进 tool schema 只是白烧 token 再顺手误导它。
 *
 * <p><b>② 未配置提示漏掉了唯一不要钱的那条路。</b> 它只说「在 .env 里设 GLM_API_KEY」，
 * 而 {@link SearxngSearchProvider} 是<b>免费且不需要任何 key</b> 的（自托管元搜索引擎，
 * 一条 docker run 就起）。对「我不想配 GLM」的用户来说，那才是答案。
 * 而且提示里说的 `.env` 现在也不全 —— key 也能从 `~/.wraith/config.json` 读（桌面 Provider 面板存的就是它）。
 */
class SearchUnavailableHintTest {

    // ── ① 工具描述 ─────────────────────────────────────────────────────────

    /** 取模型真正看到的那份描述:走 getToolDefinitions(),即喂进 tool schema 的同一份。 */
    private static String webSearchDescription() {
        return new ToolRegistry().getToolDefinitions().stream()
                .filter(t -> "web_search".equals(t.name()))
                .findFirst().orElseThrow(() -> new AssertionError("web_search 工具不存在"))
                .description();
    }

    @Test
    @DisplayName("不再声称 SerpAPI 是默认 —— 默认是 zhipu")
    void descriptionDoesNotLieAboutDefault() {
        assertFalse(webSearchDescription().contains("SerpAPI（默认）"),
                "工厂的默认是 zhipu,不是 SerpAPI: " + webSearchDescription());
    }

    @Test
    @DisplayName("不把 provider 配置细节塞进 tool schema —— 模型不选 provider,写了只会被它当事实转述")
    void descriptionOmitsProviderPlumbing() {
        String d = webSearchDescription();
        for (String leak : new String[]{"SerpAPI", "SearXNG", "SEARCH_PROVIDER", "provider"}) {
            assertFalse(d.contains(leak), "描述里不该出现「" + leak + "」: " + d);
        }
    }

    @Test
    @DisplayName("仍然说清它是干什么的 —— 不能为了删错话把有用的也删了")
    void descriptionStillDescribesTheTool() {
        String d = webSearchDescription();
        assertTrue(d.contains("搜索"), d);
        assertTrue(d.length() >= 20, "描述不能删到只剩两个字: " + d);
    }

    // ── ② 未配置提示 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("中立的未配置提示要给出全部三条路 —— 载体是 UnconfiguredSearchProvider,不再是 Zhipu")
    void unconfiguredHintListsAllThreeRoutes() {
        // 这条用例此前断在 new ZhipuSearchProvider(null, null).unavailableHint() 上,
        // 而那正是 D2 要修的错位:「什么都没配」这句话由智谱 provider 代言,
        // 于是模型张口就说 GLM。内容早就是三路并列了,载体这次才换。
        String hint = new UnconfiguredSearchProvider(() -> false, () -> false).unavailableHint();
        assertTrue(hint.contains("GLM_API_KEY"), hint);
        assertTrue(hint.contains("SERPAPI_KEY"), hint);
        assertTrue(hint.contains("SEARXNG"), hint);
    }

    @Test
    @DisplayName("必须点明 SearXNG **不需要 key** —— 这是「我不想配 key」的用户唯一的答案")
    void unconfiguredHintFlagsTheKeyFreeRoute() {
        String hint = new UnconfiguredSearchProvider(() -> false, () -> false).unavailableHint();
        assertTrue(hint.contains("不需要") || hint.contains("免费") || hint.contains("无需"),
                "没有任何地方说 SearXNG 不要钱不要 key: " + hint);
    }

    @Test
    @DisplayName("不再暗示只能写 .env —— config.json 现在也读得到(桌面 Provider 面板存的就是它)")
    void zhipuHintDoesNotClaimDotEnvOnly() {
        String hint = new ZhipuSearchProvider(null, null).unavailableHint();
        assertTrue(hint.contains("config.json") || hint.contains("桌面") || hint.contains("环境变量"),
                "取值链已扩到 config.json,提示却还只说 .env: " + hint);
    }

    @Test
    @DisplayName("提示只在真的没配时出现;配上了就 isReady,不该再喊")
    void hintOnlyMattersWhenNotReady() {
        assertFalse(new ZhipuSearchProvider(null, null).isReady());
        assertTrue(new ZhipuSearchProvider("sk-whatever", null).isReady());
    }

    @Test
    @DisplayName("每个 provider 都给得出非空提示 —— 谁也不许静默")
    void everyProviderHasAHint() {
        for (SearchProvider p : new SearchProvider[]{
                new ZhipuSearchProvider(null, null),
                new SerpApiSearchProvider(null),
                new SearxngSearchProvider(null),
                new UnconfiguredSearchProvider(() -> false, () -> false),
                // DDG 的 unavailableHint() 因 isReady() 恒真而不会被展示,但仍须非空 ——
                // 留一句空串会让后来人以为这里没写完。
                new DuckDuckGoSearchProvider()}) {
            assertNotNull(p.unavailableHint(), p.getClass().getSimpleName());
            assertFalse(p.unavailableHint().isBlank(), p.getClass().getSimpleName());
        }
    }
}
