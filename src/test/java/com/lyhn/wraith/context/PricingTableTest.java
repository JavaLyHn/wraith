package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PricingTableTest {

    private static WraithConfig.PricingEntry entry(String prefix, double hit, double miss, double out, String cur) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(hit);
        e.setCacheMissPerM(miss);
        e.setOutputPerM(out);
        e.setCurrency(cur);
        return e;
    }

    @Test
    void unknownModelYieldsEmptyNotZero() {
        PricingTable t = new PricingTable(List.of());
        assertTrue(t.resolve("totally-unknown-llm").isEmpty());
        assertTrue(t.formatCost("totally-unknown-llm", 1_000_000, 1_000_000, 0).isEmpty(),
                "未知模型宁缺勿虚:不给 0 不给猜");
    }

    @Test
    void configOverridesSeedAndLongestPrefixWins() {
        PricingTable t = new PricingTable(List.of(
                entry("my-model", 1, 2, 3, "CNY"),
                entry("my-model-pro", 10, 20, 30, "CNY")));
        assertEquals(20.0, t.resolve("my-model-pro-32k").orElseThrow().cacheMissPerM(), 1e-9,
                "最长前缀优先");
        assertEquals(2.0, t.resolve("my-model-base").orElseThrow().cacheMissPerM(), 1e-9);
    }

    @Test
    void costFormulaSplitsCacheHitMiss() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // 1M input 其中 40万 cache 命中,50万 output:
        // 0.4*1 + 0.6*10 + 0.5*20 = 16.4
        assertEquals(16.4, t.cost("m", 1_000_000, 500_000, 400_000).orElseThrow(), 1e-6);
        assertEquals("¥16.4000", t.formatCost("m", 1_000_000, 500_000, 400_000).orElseThrow());
    }

    @Test
    void noCacheSplitFallsBackToAllMiss() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // cached=0(provider 不回传拆分)→ 全按 miss 保守计
        assertEquals(10.0, t.cost("m", 1_000_000, 0, 0).orElseThrow(), 1e-6);
    }

    @Test
    void cachedClampedToInput() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // cached > input 的脏数据钳到 input
        assertEquals(1.0, t.cost("m", 1_000_000, 0, 9_000_000).orElseThrow(), 1e-6);
    }

    @Test
    void usdCurrencyFormatsWithDollar() {
        PricingTable t = new PricingTable(List.of(entry("v4", 0.0028, 0.14, 0.28, "USD")));
        assertTrue(t.formatCost("v4-flash", 1_000_000, 0, 0).orElseThrow().startsWith("$"));
    }
}
