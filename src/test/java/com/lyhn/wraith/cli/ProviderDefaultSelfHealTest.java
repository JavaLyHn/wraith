package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 存/删 provider 时把 stale 的 defaultProvider 修好。
 *
 * <p><b>起因</b>：{@code Main.java:1487-1488} 的注释承诺「首个 provider 落地后就地热装 ……
 * 存完立刻可用，不需要用户再去点一次「设默认」」——对旧白名单 6 家之外的 provider 全是假的。
 * 因为 {@code configSetProvider} <b>从不设置 defaultProvider</b>，而 defaultProvider 的
 * 硬编码初值 {@code "glm"} 会被 {@code save()} 落盘。
 *
 * <p><b>为什么不静默改写用户文件</b>：读路径已由 {@code ModelCatalog} 报有效默认兜住，
 * stale 值不影响行为。只在用户<b>主动写入</b>（存 provider / 删 provider）时顺手修好，
 * 这两个时机用户本来就在改配置，不算意外副作用。
 *
 * <p>「挑一个有 key 的」这条规则原本只装在 {@code configRemoveProvider}（:1494-1500），
 * 现在两边共用 {@code ProviderResolver}，不写第五份。
 */
class ProviderDefaultSelfHealTest {

    private static WraithConfig cfgWithDefault(String defaultProvider) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new LinkedHashMap<>());
        return c;
    }

    private static void put(WraithConfig c, String id, String key) {
        c.getProviders().put(id, new WraithConfig.ProviderConfig(key, null, "m"));
    }

    @Test
    @DisplayName("stale 默认 + 有效值是 anthropic → 默认改成 anthropic")
    void healsStaleDefaultAfterSave() {
        WraithConfig c = cfgWithDefault("glm");     // 老 config.json 落盘的硬编码初值
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c, "anthropic");

        assertEquals("anthropic", c.getDefaultProvider(),
                "存完就该能用,不该还要用户去点一次「设默认」");
    }

    @Test
    @DisplayName("默认已经有效 → 一个字都不动(不能把用户的显式选择改掉)")
    void leavesValidDefaultAlone() {
        WraithConfig c = cfgWithDefault("deepseek");
        put(c, "deepseek", "sk-d");
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c, "deepseek");

        assertEquals("deepseek", c.getDefaultProvider());
    }

    @Test
    @DisplayName("删掉当前默认那个 → 落到下一个有 key 的")
    void healsAfterRemovingCurrentDefault() {
        WraithConfig c = cfgWithDefault("anthropic");
        put(c, "siliconflow", "sk-s");            // anthropic 已被 remove,只剩这个

        ProviderDefaults.healDefault(c, "siliconflow");

        assertEquals("siliconflow", c.getDefaultProvider());
    }

    @Test
    @DisplayName("有效值为空串(删到一个都不剩)→ 默认清空,不留一个指向虚空的 id")
    void clearsDefaultWhenNothingLeft() {
        WraithConfig c = cfgWithDefault("anthropic");

        ProviderDefaults.healDefault(c, "");

        assertNull(c.getDefaultProvider(), "实际: " + c.getDefaultProvider());
    }

    @Test
    @DisplayName("默认为 null(新版初值)且有效值有了 → 设成它")
    void setsDefaultOnFirstProvider() {
        WraithConfig c = cfgWithDefault(null);
        put(c, "siliconflow", "sk-s");

        ProviderDefaults.healDefault(c, "siliconflow");

        assertEquals("siliconflow", c.getDefaultProvider());
    }

    @Test
    @DisplayName("null / 空 config 不抛")
    void nullInputsAreSafe() {
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(null, "anthropic"));
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(null));
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(cfgWithDefault(null), null));
    }

    @Test
    @DisplayName("生产入口跑完后,默认值必定是「空」或「一个真有 key 的 provider」")
    void productionEntryPointLeavesUsableDefault() {
        // 断言的是一条**在任何机器上都成立的不变式**,而不是具体是哪个 provider ——
        // 后者取决于跑它的机器设了哪些环境变量(设了 GLM_API_KEY 的机器上 glm 确实有 key)。
        // 「具体谁是有效默认」由 ProviderResolverTest 覆盖。
        WraithConfig c = cfgWithDefault("glm");
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c);

        String after = c.getDefaultProvider();
        if (after != null) {
            assertFalse(after.isBlank(), "要么是 null,要么是个真名字,不该留空白串");
            String key = c.getApiKey(after);
            assertTrue(key != null && !key.isBlank(),
                    "自愈后的默认必须拿得到 key,否则自愈没有意义。实际默认=" + after);
        }
    }
}
