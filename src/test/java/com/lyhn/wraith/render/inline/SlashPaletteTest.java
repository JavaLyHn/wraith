package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SlashPalette 的委托测试：验证 open 仍然返回正确的下标。
 *
 * <p>handleKey / fit 等纯函数测试已迁到 {@link InteractiveSelectorTest}。
 */
class SlashPaletteTest {

    @Test
    void openReturnsMinusOneForEmptyItems() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        SlashPalette palette = new SlashPalette(new PrintStream(baos), null);
        assertEquals(-1, palette.open("title", List.of()));
    }

    @Test
    void openReturnsMinusOneForNullItems() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        SlashPalette palette = new SlashPalette(new PrintStream(baos), null);
        assertEquals(-1, palette.open("title", null));
    }

    @Test
    void openReturnsCancelledWhenDelegateCancels() {
        // null terminal → InteractiveSelector.open returns cancelled for non-empty options
        // because readKey returns -1 (no terminal), handleKey(-1,...) → DECISION_CANCEL
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        SlashPalette palette = new SlashPalette(new PrintStream(baos), null);
        int result = palette.open("test", List.of("a", "b"));
        assertEquals(-1, result);
    }
}
