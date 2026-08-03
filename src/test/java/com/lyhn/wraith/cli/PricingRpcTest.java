package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * config.getPricing / config.setPricing 的载荷契约。
 *
 * <p>这里只测<b>纯逻辑部分</b>——把 config 转成回包、把回包校验成 config：
 * session 实现要 app-server 整套装配（LlmClient、SessionStore…），端到端由真机验。
 * 校验规则与 CLI 共用 {@code Main.validatePricingEntry}，所以这里重点测
 * <b>整表替换语义</b>与<b>列表级重复前缀</b>——那两条 CLI 侧没有对应场景。
 */
class PricingRpcTest {

    private static Map<String, Object> row(String prefix, double hit, double miss,
                                           double out, String currency) {
        return Map.of("modelPrefix", prefix, "cacheHitPerM", hit, "cacheMissPerM", miss,
                "outputPerM", out, "currency", currency);
    }

    @Test
    @DisplayName("整表替换：旧条目被清掉，不是合并")
    void setReplacesWholeListRatherThanMerging() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("old-a", 1, 1, 1, "CNY"),
                row("old-b", 1, 1, 1, "CNY")));
        assertEquals(2, config.getPricing().size());

        String error = Main.applyPricingEntries(config, List.of(row("new-only", 2, 2, 2, "USD")));

        assertEquals(null, error);
        assertEquals(1, config.getPricing().size(), "整表替换 —— old-a/old-b 该消失");
        assertEquals("new-only", config.getPricing().get(0).getModelPrefix());
        assertEquals("USD", config.getPricing().get(0).getCurrency());
    }

    @Test
    @DisplayName("空表是合法的（用户可以把计价全删掉）")
    void emptyListIsValid() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("x", 1, 1, 1, "CNY")));

        assertEquals(null, Main.applyPricingEntries(config, List.of()));
        assertTrue(config.getPricing().isEmpty());
    }

    @Test
    @DisplayName("同表内重复前缀被拒（忽略大小写）—— 两条同名时哪条胜出是任意的")
    void duplicatePrefixIsRejected() {
        WraithConfig config = new WraithConfig();

        String error = Main.applyPricingEntries(config,
                List.of(row("glm-4.7", 1, 1, 1, "CNY"), row("GLM-4.7", 2, 2, 2, "CNY")));

        assertNotNull(error);
        assertTrue(error.contains("glm-4.7") || error.contains("GLM-4.7"), error);
        assertTrue(config.getPricing().isEmpty(), "校验失败时一条都不该落进去");
    }

    @Test
    @DisplayName("单条非法（负价 / 空前缀 / 非法币种）整批拒绝，不部分写入")
    void invalidEntryRejectsWholeBatch() {
        WraithConfig config = new WraithConfig();

        assertNotNull(Main.applyPricingEntries(config,
                List.of(row("ok", 1, 1, 1, "CNY"), row("bad", -1, 1, 1, "CNY"))));
        assertTrue(config.getPricing().isEmpty(), "不该只写进合法那条");

        assertNotNull(Main.applyPricingEntries(config, List.of(row("", 1, 1, 1, "CNY"))));
        assertNotNull(Main.applyPricingEntries(config, List.of(row("x", 1, 1, 1, "EUR"))));
    }

    @Test
    @DisplayName("缺字段的行按 0 读、缺币种按 CNY —— 但 0 价仍要过校验（合法）")
    void missingFieldsGetDefaults() {
        WraithConfig config = new WraithConfig();

        String error = Main.applyPricingEntries(config,
                List.of(Map.of("modelPrefix", "free-model")));

        assertEquals(null, error, "0 价是合法的：确实有免费模型");
        assertEquals("CNY", config.getPricing().get(0).getCurrency());
        assertEquals(0.0, config.getPricing().get(0).getOutputPerM());
    }

    @Test
    @DisplayName("回包同时带用户条目与种子，seeded 标对")
    void getPayloadCarriesSeedFlag() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("my-model", 1, 1, 1, "CNY")));

        Map<String, Object> payload = Main.pricingPayload(config);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> entries = (List<Map<String, Object>>) payload.get("entries");
        assertNotNull(entries);
        assertTrue(entries.stream().anyMatch(e -> "my-model".equals(e.get("modelPrefix"))
                && Boolean.FALSE.equals(e.get("seeded"))));
        assertTrue(entries.stream().anyMatch(e -> "glm-5".equals(e.get("modelPrefix"))
                && Boolean.TRUE.equals(e.get("seeded"))), "内置种子也要回,并标 seeded");
        assertFalse(entries.isEmpty());
    }
}
