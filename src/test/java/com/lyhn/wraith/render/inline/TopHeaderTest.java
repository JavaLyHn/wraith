package com.lyhn.wraith.render.inline;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TopHeaderTest {

    @Test
    void rendersBrandVersionModelAndFullWidthRule() {
        int cols = 80;
        List<String> lines = TopHeader.render(cols, "16.1.0", "DeepSeek-V4-Flash");
        assertEquals(2, lines.size());
        assertTrue(lines.get(0).startsWith("▌ WRAITH"), lines.get(0));
        assertTrue(lines.get(0).contains("v16.1.0"));
        assertTrue(lines.get(0).contains("DeepSeek-V4-Flash"));
        assertTrue(lines.get(0).length() <= cols);
        assertEquals("─".repeat(cols), lines.get(1));
    }

    @Test
    void truncatesLine1AndRuleFitsNarrowTerminal() {
        int cols = 12;
        List<String> lines = TopHeader.render(cols, "16.1.0", "DeepSeek-V4-Flash");
        assertTrue(lines.get(0).length() <= cols, "line1 must fit width");
        assertTrue(lines.get(0).endsWith("…"), "overflow should be ellipsized");
        assertEquals(cols, lines.get(1).length());
    }

    @Test
    void brandOnlyWhenNoVersionOrModel() {
        List<String> lines = TopHeader.render(40, null, null);
        assertEquals("▌ WRAITH", lines.get(0));
        assertEquals("─".repeat(40), lines.get(1));
    }
}
