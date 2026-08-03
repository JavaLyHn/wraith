package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * view() 是给 /config pricing --list 与桌面面板用的只读视图。
 *
 * <p>顺带守住 spec §2.3 那个静默陷阱：<b>config 条目是前缀匹配、种子要求精确相等</b>。
 * 这个差异不是 bug（注释写明前缀的模糊范围由用户承担），但它是静默的——
 * 用户填 {@code glm} 会让 glm-4.7 / glm-5v-turbo 全套同一个价。
 */
class PricingTableViewTest {

    private static WraithConfig.PricingEntry entry(String prefix, double hit, double miss,
                                                   double out, String currency) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(hit);
        e.setCacheMissPerM(miss);
        e.setOutputPerM(out);
        e.setCurrency(currency);
        return e;
    }

    @Test
    @DisplayName("view() 同时列出用户条目与内置种子，seeded 标对")
    void listsUserEntriesAndSeedsWithCorrectFlag() {
        PricingTable table = new PricingTable(List.of(entry("my-relay-model", 1, 2, 3, "CNY")));

        List<PricingTable.View> view = table.view();

        PricingTable.View mine = view.stream()
                .filter(v -> "my-relay-model".equals(v.modelKey())).findFirst().orElseThrow();
        assertFalse(mine.seeded(), "用户条目不是种子");
        assertEquals(2.0, mine.price().cacheMissPerM());

        assertTrue(view.stream().anyMatch(v -> "glm-5".equals(v.modelKey()) && v.seeded()),
                "内置种子也要在视图里,并标 seeded");
        assertTrue(view.stream().anyMatch(v -> "deepseek-v4-pro".equals(v.modelKey()) && v.seeded()));
    }

    @Test
    @DisplayName("用户条目排在种子之前 —— 与构造器里 config 先于 SEEDS 的顺序一致")
    void userEntriesComeFirst() {
        PricingTable table = new PricingTable(List.of(entry("zzz-model", 1, 1, 1, "CNY")));

        List<PricingTable.View> view = table.view();

        assertFalse(view.get(0).seeded(), "第一条该是用户条目");
    }

    @Test
    @DisplayName("view() 不可变 —— 调用方拿不到内部列表的写权限")
    void viewIsImmutable() {
        List<PricingTable.View> view = new PricingTable(List.of()).view();

        org.junit.jupiter.api.Assertions.assertThrows(UnsupportedOperationException.class,
                () -> view.add(new PricingTable.View("x", new PricingTable.Price(1, 1, 1, "CNY"), false)));
    }

    @Test
    @DisplayName("守门：config 条目是前缀匹配,种子要求精确相等(spec §2.3 的静默陷阱)")
    void configEntriesArePrefixSeedsAreExact() {
        // 用户填 "glm" —— 前缀语义,会命中所有 glm-*
        PricingTable withPrefix = new PricingTable(List.of(entry("glm", 7, 7, 7, "CNY")));
        assertEquals(7.0, withPrefix.resolve("glm-4.7").orElseThrow().outputPerM(),
                "config 条目该按前缀命中");
        assertEquals(7.0, withPrefix.resolve("glm-5v-turbo").orElseThrow().outputPerM(),
                "同一条前缀会命中多个变体 —— 这正是要在 UI 里显示出来的那件事");

        // 种子 "glm-5" 精确相等才命中:glm-5.1 不该套用 glm-5 的旗舰价
        PricingTable seedsOnly = new PricingTable(List.of());
        assertEquals(60.0, seedsOnly.resolve("glm-5").orElseThrow().outputPerM());
        assertTrue(seedsOnly.resolve("glm-5.1").isEmpty(),
                "种子是精确匹配:glm-5.1 不该静默套用 glm-5 的价");
    }
}
