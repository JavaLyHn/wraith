package com.lyhn.wraith.render.inline;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 固定区 banner 的纯逻辑测试(不依赖 Terminal,JDK 26 下可运行)。 */
class PinnedBannerTest {

    @Test
    void heightIsContentPlusSeparator() {
        assertEquals(3, new PinnedBanner(List.of("a", "b")).height());
    }

    @Test
    void separatorScalesToColumnWidth() {
        List<String> lines = new PinnedBanner(List.of("x")).lines(20);
        assertEquals(2, lines.size());
        long bars = lines.get(1).chars().filter(c -> c == '─').count();
        assertEquals(20, bars, "separator should fill the column width");
    }

    @Test
    void emptyBannerIsJustSeparator() {
        PinnedBanner banner = new PinnedBanner(List.of());
        assertEquals(1, banner.height());
        assertTrue(banner.isEmpty());
    }
}
