package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * pricing 是 config.json 五节里唯一 CLI 与桌面两边都没有写入口的一节 ——
 * 用户只能手改 JSON。中转站实付价只有用户自己知道（官方牌价 ≠ 实付价），
 * 所以「能填」比「表里有什么」重要得多。
 *
 * <p>红线：需要落盘的用例一律 @TempDir + -Dwraith.config.dir，不碰真实 ~/.wraith/config.json。
 */
class PricingConfigCommandTest {

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

    private static WraithConfig withProviders(String... providerAndModel) {
        WraithConfig config = new WraithConfig();
        for (int i = 0; i < providerAndModel.length; i += 2) {
            config.getProviders().put(providerAndModel[i],
                    new WraithConfig.ProviderConfig("sk-fake", null, providerAndModel[i + 1]));
        }
        return config;
    }

    // ── 解析 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("单条写入解析出四个数值与币种")
    void parsesUpsert() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60 --currency CNY");

        assertNull(u.error());
        assertEquals(Main.PricingAction.UPSERT, u.action());
        assertEquals("glm-4.7", u.modelPrefix());
        assertEquals(20.0, u.cacheHitPerM());
        assertEquals(60.0, u.outputPerM());
        assertEquals("CNY", u.currency());
    }

    @Test
    @DisplayName("币种缺省是 CNY（与 PricingEntry 的字段默认一致）")
    void currencyDefaultsToCny() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1");

        assertEquals("CNY", u.currency());
    }

    @Test
    @DisplayName("--list 与裸 pricing 都是列出")
    void parsesList() {
        assertEquals(Main.PricingAction.LIST, Main.parsePricingConfigUpdate("pricing --list").action());
        assertEquals(Main.PricingAction.LIST, Main.parsePricingConfigUpdate("pricing").action());
    }

    @Test
    @DisplayName("--remove 解析出要删的前缀")
    void parsesRemove() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate("pricing --remove glm-4.7");

        assertEquals(Main.PricingAction.REMOVE, u.action());
        assertEquals("glm-4.7", u.modelPrefix());
    }

    @Test
    @DisplayName("三个价缺任何一个都报错，不静默当 0 —— 0 意味着「免费」是错误信息")
    void missingAnyPriceIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-hit 1 --cache-miss 1").error());
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-hit 1 --output 1").error());
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-miss 1 --output 1").error());
    }

    @Test
    @DisplayName("价不是数字时报人话")
    void nonNumericPriceIsAnError() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit abc --cache-miss 1 --output 1");

        assertNotNull(u.error());
        assertTrue(u.error().contains("abc"), "该把用户敲的那个值回给他: " + u.error());
    }

    @Test
    @DisplayName("负价报错 —— 算出负成本比不显示更糟")
    void negativePriceIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate(
                "pricing m --cache-hit -1 --cache-miss 1 --output 1").error());
    }

    @Test
    @DisplayName("非法币种报错 —— formatCost 只认 USD，其余一律渲染成 ¥，允许 EUR 会骗人")
    void unsupportedCurrencyIsAnError() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --currency EUR");

        assertNotNull(u.error());
        assertTrue(u.error().contains("CNY") && u.error().contains("USD"), u.error());
    }

    @Test
    @DisplayName("币种大小写不敏感，归一成大写")
    void currencyIsCaseInsensitive() {
        assertEquals("USD", Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --currency usd").currency());
    }

    @Test
    @DisplayName("未知配置项报错")
    void unknownOptionIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --discount 0.5").error());
    }

    // ── 命中提示（spec §3.4 的同一份逻辑，CLI 与面板共用语义） ─────────────

    @Test
    @DisplayName("pricingMatchedModels 用的是 config 条目的语义：小写 startsWith")
    void matchedModelsUsesPrefixSemantics() {
        WraithConfig config = withProviders(
                "freellmapi-4", "glm-4.7",
                "freellmapi-5", "glm-5v-turbo",
                "siliconflow", "Qwen/Qwen3-8B");

        assertEquals(List.of("glm-4.7", "glm-5v-turbo"), Main.pricingMatchedModels("glm", config),
                "填 glm 会命中两个 —— 这正是要显示给用户看的那件事");
        assertEquals(List.of("glm-4.7"), Main.pricingMatchedModels("glm-4.7", config));
        assertEquals(List.of("Qwen/Qwen3-8B"), Main.pricingMatchedModels("qwen/", config),
                "大小写不敏感");
        assertTrue(Main.pricingMatchedModels("gpt-", config).isEmpty());
    }

    // ── 接线 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("接线：写进 config.getPricing() 并落盘，回显带「会命中哪几个模型」")
    void upsertWritesAndEchoesMatchedModels(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = withProviders("freellmapi-4", "glm-4.7");

            String out = Main.handleConfigCommand(config,
                    "pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60");

            assertEquals(1, config.getPricing().size());
            assertEquals("glm-4.7", config.getPricing().get(0).getModelPrefix());
            assertEquals(60.0, config.getPricing().get(0).getOutputPerM());
            assertTrue(out.contains("glm-4.7"), out);
        });
    }

    @Test
    @DisplayName("接线：同前缀再写一次是覆盖，不是加第二条")
    void upsertOverwritesSamePrefix(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            Main.handleConfigCommand(config, "pricing m --cache-hit 1 --cache-miss 1 --output 1");
            Main.handleConfigCommand(config, "pricing m --cache-hit 2 --cache-miss 2 --output 2");

            assertEquals(1, config.getPricing().size(), "同前缀该覆盖 —— 两条同名时哪条胜出是任意的");
            assertEquals(2.0, config.getPricing().get(0).getOutputPerM());
        });
    }

    @Test
    @DisplayName("接线：命中 0 个模型时给警示，但仍然写进去（可能在为还没配的模型预填价）")
    void zeroMatchWarnsButStillWrites(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = withProviders("freellmapi-4", "glm-4.7");

            String out = Main.handleConfigCommand(config,
                    "pricing gpt-5 --cache-hit 1 --cache-miss 1 --output 1");

            assertEquals(1, config.getPricing().size(), "不阻止保存");
            assertTrue(out.contains("⚠"), "但必须让他看见: " + out);
        });
    }

    @Test
    @DisplayName("接线：--remove 删掉那条；删不存在的报错而不是静默成功")
    void removeDeletesAndReportsMissing(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();
            Main.handleConfigCommand(config, "pricing m --cache-hit 1 --cache-miss 1 --output 1");

            String removed = Main.handleConfigCommand(config, "pricing --remove m");
            assertTrue(config.getPricing().isEmpty(), removed);

            String missing = Main.handleConfigCommand(config, "pricing --remove nope");
            assertTrue(missing.contains("❌"), "删不存在的该报错,不该静默成功: " + missing);
        });
    }

    @Test
    @DisplayName("接线：--list 同时列出用户条目与内置种子，种子标注不可编辑")
    void listShowsUserEntriesAndSeeds(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();
            Main.handleConfigCommand(config, "pricing my-model --cache-hit 1 --cache-miss 1 --output 1");

            String out = Main.handleConfigCommand(config, "pricing --list");

            assertTrue(out.contains("my-model"), out);
            assertTrue(out.contains("glm-5"), "内置种子也要列出: " + out);
            assertTrue(out.contains("内置"), "种子要标注: " + out);
        });
    }

    @Test
    @DisplayName("接线：写完调 ConfigReloadHook —— 否则本次会话状态栏仍不显示费用")
    void invokesReloadHookAfterWriting(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            boolean[] called = {false};
            Main.ConfigReloadHook hook = cfg -> called[0] = true;

            Main.handleConfigCommand(new WraithConfig(),
                    "pricing m --cache-hit 1 --cache-miss 1 --output 1", hook);

            assertTrue(called[0], "第六次 snapshot-vs-live：不刷新则写了等于没写");
        });
    }

    @Test
    @DisplayName("/config provider 与 /config search 两条路都没被 pricing 分支影响")
    void siblingBranchesStillWork(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            assertTrue(Main.handleConfigCommand(config, "provider myrelay --api-key sk-fake-relay")
                    .contains("myrelay"));
            assertTrue(Main.handleConfigCommand(config,
                    "search --provider searxng --base-url http://localhost:8888").contains("searxng"));
            assertFalse(config.getProviders().isEmpty());
            assertNotNull(config.getSearch());
        });
    }
}
