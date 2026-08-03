package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 全新 config 不该预设任何 provider。
 *
 * <p>{@code defaultProvider} 的硬编码初值曾是 {@code "glm"}，而 {@link WraithConfig#save()}
 * 整对象落盘 —— 于是全新安装第一次保存就把 {@code "glm"} 写进了
 * {@code ~/.wraith/config.json}，哪怕用户配的是 anthropic。用户的原话是
 * 「最开始面向 glm 只是因为我只有 glm 的，现在不应该出现只能用 glm 才能完成的事情」。
 *
 * <p>本测试只碰内存对象，不读写真实 config.json。
 */
class DefaultProviderInitialValueTest {

    @Test
    @DisplayName("全新 WraithConfig 的 defaultProvider 不预设任何 provider")
    void freshConfigHasNoPresetDefault() {
        String actual = new WraithConfig().getDefaultProvider();

        assertTrue(actual == null || actual.isBlank(),
                "全新 config 不该预设 provider,实际是: " + actual);
    }

    @Test
    @DisplayName("尤其不能是 glm")
    void freshConfigDefaultIsNotGlm() {
        assertNotEquals("glm", new WraithConfig().getDefaultProvider());
    }

    @Test
    @DisplayName("null 默认下,effectiveDefault 与 candidates 首项始终一致")
    void nullDefaultKeepsResolverSelfConsistent() {
        // 断言的是两个 API 之间的**关系**,在任何机器上都成立;
        // 不断言具体值 —— 那取决于跑它的机器设了哪些 *_API_KEY。
        WraithConfig c = new WraithConfig();

        java.util.List<String> list = ProviderResolver.candidates(c);
        String expected = list.isEmpty() ? "" : list.get(0);

        assertEquals(expected, ProviderResolver.effectiveDefault(c),
                "effectiveDefault 必须就是候选首项,否则两个入口会给出矛盾的答案");
    }
}
