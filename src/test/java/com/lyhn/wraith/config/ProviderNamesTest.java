package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * X1: 用户把 anthropic 写成通俗叫法 "claude" 时,别名表要能归一到 "anthropic"——
 * 否则 {@code LlmClientFactory.create} 的 switch 落进 default 分支,把 Anthropic key
 * 发给 api.openai.com(见 progress.md 最终修复波定向复评 [X1])。
 */
class ProviderNamesTest {

    @Test
    @DisplayName("claude 归一为 anthropic(X1)")
    void claudeNormalizesToAnthropic() {
        assertEquals("anthropic", ProviderNames.normalize("claude"));
    }

    @Test
    @DisplayName("大小写不敏感")
    void claudeNormalizationIsCaseInsensitive() {
        assertEquals("anthropic", ProviderNames.normalize("Claude"));
        assertEquals("anthropic", ProviderNames.normalize("CLAUDE"));
    }

    @Test
    @DisplayName("拼写错误不进别名表——原样返回(小写化),交给上层的端点警示兜底")
    void misspelledVariantsAreNotAliased() {
        // 故意不给 "anthropi"/"antropic"/"anthropics" 登记别名——那是无底洞。
        // 这里只锁住"没有偷偷加别名"这条边界,不是要求任何特定行为。
        assertEquals("anthropi", ProviderNames.normalize("anthropi"));
        assertEquals("antropic", ProviderNames.normalize("antropic"));
        assertEquals("anthropics", ProviderNames.normalize("anthropics"));
    }
}
