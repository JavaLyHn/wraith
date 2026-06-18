package com.lyhn.wraith.render.intro;

import com.lyhn.wraith.render.WraithWordmark;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IntroAnimationFramesTest {

    @Test
    void framesAreNonEmptyAndWithinWidth() {
        int cols = 80;
        List<List<String>> frames = IntroAnimation.frames(cols);
        assertFalse(frames.isEmpty(), "should produce frames at 80 cols");
        for (List<String> frame : frames) {
            assertEquals(WraithWordmark.height(), frame.size(), "each frame has wordmark height rows");
            for (String row : frame) {
                assertTrue(row.length() <= cols, "row exceeds cols: <" + row + ">");
            }
        }
    }

    @Test
    void lastFrameIsCenteredWordmark() {
        int cols = 80;
        List<List<String>> frames = IntroAnimation.frames(cols);
        List<String> last = frames.get(frames.size() - 1);
        int basePad = (cols - WraithWordmark.width()) / 2;
        String pad = " ".repeat(basePad);
        for (int i = 0; i < WraithWordmark.height(); i++) {
            assertEquals(pad + WraithWordmark.LINES.get(i), last.get(i), "row " + i + " centered");
        }
    }

    @Test
    void tooNarrowYieldsNoFrames() {
        assertTrue(IntroAnimation.frames(WraithWordmark.width()).isEmpty(), "no margin -> no frames");
        assertTrue(IntroAnimation.frames(10).isEmpty(), "tiny terminal -> no frames");
    }
}
