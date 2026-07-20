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

    @Test
    void seedRequiresExactMatch() {
        // 纯种子表(无 config 覆盖):种子只认"确切标识符",不认前缀家族。
        PricingTable t = new PricingTable(List.of());
        // "glm-5" 是种子的确切标识符 → 精确命中
        assertEquals(60.0, t.resolve("glm-5").orElseThrow().outputPerM(), 1e-9);
        // "glm-5.1" 是本仓库默认模型,未核对过价格,种子层不能静默套用 "glm-5" 的价——必须缺席
        assertTrue(t.resolve("glm-5.1").isEmpty(),
                "glm-5.1 未核对,种子精确匹配下不应命中 glm-5 的价");
        assertTrue(t.resolve("glm-5.1-nonexistent-variant").isEmpty());
    }

    @Test
    void configPrefixOverridesRealSeed() {
        // 用真实 SEEDS(而非纯合成条目):config 里配一条 "glm-5" 前缀,应覆盖同名种子。
        WraithConfig.PricingEntry userGlm5 = entry("glm-5", 1.0, 1.0, 1.0, "CNY");
        PricingTable t = new PricingTable(List.of(userGlm5));
        // "glm-5" 本身:config(前缀,长度5)与种子(精确,长度5)同长度,config 先命中。
        assertEquals(1.0, t.resolve("glm-5").orElseThrow().outputPerM(), 1e-9,
                "同长度时 config 先于种子命中");
        // config 是前缀匹配,所以连未核对的 glm-5.1 变体也会被用户口径接住(用户自己的选择)。
        assertEquals(1.0, t.resolve("glm-5.1").orElseThrow().outputPerM(), 1e-9,
                "config 前缀覆盖到变体,是用户自己承担的模糊范围");
    }

    @Test
    void seedMatchIsCaseInsensitive() {
        // 修:模型标识符大小写无关。实际客户端报 "DeepSeek-V4-Flash",种子键为小写 "deepseek-v4-flash",
        // 此前大小写敏感(equals/startsWith)致种子价永不命中 → 成本静默缺席。
        PricingTable t = new PricingTable(List.of());
        assertEquals(0.28, t.resolve("DeepSeek-V4-Flash").orElseThrow().outputPerM(), 1e-9,
                "混合大小写模型名应命中小写种子");
        assertEquals(0.28, t.resolve("deepseek-v4-flash").orElseThrow().outputPerM(), 1e-9);
        // 归一不放松「精确=同一标识符」:非同一标识符(哪怕是前缀)仍不命中种子
        assertTrue(t.resolve("DeepSeek-V4").isEmpty(), "前缀而非同一标识符,种子精确语义不放松");
    }
}
