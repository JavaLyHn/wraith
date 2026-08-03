package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * `search` 节需要有人能写它，否则 D1 加的那一节只能手改 config.json，整条设计失去意义。
 *
 * <p>红线：不碰真实 ~/.wraith/config.json —— 需要落盘的用例一律 @TempDir +
 * -Dwraith.config.dir，并在 finally 里还原系统属性。
 */
class SearchConfigCommandTest {

    /** 把 config 落盘重定向到临时目录再跑 body —— 绝不碰真实 ~/.wraith/config.json。 */
    private static void withTempConfigDir(Path tempDir, Runnable body) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            body.run();
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("四个 provider 各自解析得到")
    void parsesAllFourProviders() {
        assertEquals("searxng", Main.parseSearchConfigUpdate(
                "search --provider searxng --base-url http://localhost:8888").provider());
        assertEquals("serpapi", Main.parseSearchConfigUpdate(
                "search --provider serpapi --api-key sk-fake-serp").provider());
        assertEquals("zhipu", Main.parseSearchConfigUpdate("search --provider zhipu").provider());
        assertEquals("duckduckgo", Main.parseSearchConfigUpdate("search --provider duckduckgo").provider());
    }

    @Test
    @DisplayName("非法 provider 给人话报错，不静默忽略")
    void rejectsUnknownProviderWithAHumanMessage() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --provider google");

        assertNotNull(update.error());
        assertTrue(update.error().contains("zhipu"), "该把支持的名字列出来");
        assertTrue(update.error().contains("duckduckgo"));
    }

    @Test
    @DisplayName("--provider 是必需的 —— provider 为空时 apiKey 归属不可猜")
    void providerIsRequired() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --api-key sk-fake");

        assertNotNull(update.error());
        assertTrue(update.error().contains("--provider"));
    }

    @Test
    @DisplayName("searxng 缺 --base-url 时报错")
    void searxngRequiresBaseUrl() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --provider searxng");

        assertNotNull(update.error());
        assertTrue(update.error().contains("--base-url"));
    }

    @Test
    @DisplayName("duckduckgo 带 --api-key 或 --base-url 时报错，不静默吞掉")
    void duckDuckGoRejectsKeyAndBaseUrl() {
        // 静默吞掉会让用户以为 key 生效了,之后排查不可能
        Main.SearchConfigUpdate withKey = Main.parseSearchConfigUpdate(
                "search --provider duckduckgo --api-key sk-fake");
        assertNotNull(withKey.error());
        assertTrue(withKey.error().contains("--api-key"));

        Main.SearchConfigUpdate withUrl = Main.parseSearchConfigUpdate(
                "search --provider duckduckgo --base-url http://x");
        assertNotNull(withUrl.error());
        assertTrue(withUrl.error().contains("--base-url"));
    }

    @Test
    @DisplayName("未知配置项报错")
    void rejectsUnknownOption() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate(
                "search --provider zhipu --engine search_pro");

        assertNotNull(update.error());
        assertTrue(update.error().contains("engine"));
    }

    @Test
    @DisplayName("接线：写进 config 的 search 节并落盘，apiKey 回显掩码")
    void writesSearchSectionAndMasksKeyInEcho(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            String out = Main.handleConfigCommand(config,
                    "search --provider serpapi --api-key sk-fake-serpapi-1234567890");

            assertNotNull(config.getSearch());
            assertEquals("serpapi", config.getSearch().getProvider());
            assertEquals("sk-fake-serpapi-1234567890", config.getSearch().getApiKey());
            assertFalse(out.contains("sk-fake-serpapi-1234567890"), "回显不得带明文 key");
            assertTrue(out.contains("..."), "该是掩码形式");
        });
    }

    @Test
    @DisplayName("接线：searxng 的 baseUrl 写进 search 节")
    void writesSearxngBaseUrl(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            Main.handleConfigCommand(config,
                    "search --provider searxng --base-url http://localhost:8888");

            assertEquals("searxng", config.getSearch().getProvider());
            assertEquals("http://localhost:8888", config.getSearch().getBaseUrl());
            assertNull(config.getSearch().getApiKey());
        });
    }

    @Test
    @DisplayName("接线：写完调 ConfigReloadHook —— 否则本次会话仍用旧 provider / 旧计价表")
    void invokesReloadHookAfterWriting(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            // 第三参此前是 ToolRegistry,断言的是「registry.invalidateSearchProvider 被调了」;
            // pricing 也要刷东西(Agent 的计价表),继续往签名上加参数会一路长下去,故收成
            // ConfigReloadHook。
            //
            // 「invalidateSearchProvider 真的清空了缓存」由 tool 包里的 SearchProviderCacheTest
            // 继续守 —— 那两个测试钩子(setSearchProviderForTest / searchProviderSnapshotForTest)
            // 是包可见的,cli 包这里够不到。
            boolean[] called = {false};

            Main.handleConfigCommand(new WraithConfig(),
                    "search --provider searxng --base-url http://localhost:8888",
                    cfg -> called[0] = true);

            assertTrue(called[0], "第五、第六次 snapshot-vs-live：不刷新则写了等于没写");
        });
    }

    @Test
    @DisplayName("/config provider 那条路没被 search 分支影响")
    void providerBranchStillWorks(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            String out = Main.handleConfigCommand(config, "provider myrelay --api-key sk-fake-relay");

            assertTrue(out.contains("myrelay"));
            assertNotNull(config.getProviders().get("myrelay"));
        });
    }
}
