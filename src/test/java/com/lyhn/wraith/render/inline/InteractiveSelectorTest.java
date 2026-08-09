package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class InteractiveSelectorTest {

    @Test
    void handleKeyUpMovesSelection() {
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_UP, 0, 3);
        assertEquals(InteractiveSelector.DECISION_UP, result);
    }

    @Test
    void handleKeyDownMovesSelection() {
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_DOWN, 0, 3);
        assertEquals(InteractiveSelector.DECISION_DOWN, result);
    }

    @Test
    void handleKeyEnterConfirms() {
        int result = InteractiveSelector.handleKey('\r', 2, 3);
        assertEquals(InteractiveSelector.DECISION_CONFIRM, result);
    }

    @Test
    void handleKeyEscCancels() {
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_ESC, 0, 3);
        assertEquals(InteractiveSelector.DECISION_CANCEL, result);
    }

    @Test
    void handleKeyDigitSelectsDirectly() {
        int result = InteractiveSelector.handleKey('2', 0, 3);
        assertEquals(1, result);
    }

    @Test
    void handleKeyDigitOutOfRangeIsNone() {
        int result = InteractiveSelector.handleKey('9', 0, 3);
        assertEquals(InteractiveSelector.DECISION_NONE, result);
    }

    @Test
    void handleKeyQCancels() {
        int result = InteractiveSelector.handleKey('q', 0, 3);
        assertEquals(InteractiveSelector.DECISION_CANCEL, result);
    }

    @Test
    void handleKeyJKNavigate() {
        assertEquals(InteractiveSelector.DECISION_UP, InteractiveSelector.handleKey('k', 0, 3));
        assertEquals(InteractiveSelector.DECISION_DOWN, InteractiveSelector.handleKey('j', 0, 3));
    }

    @Test
    void fitTruncatesCjkCharacters() {
        String fitted = InteractiveSelector.fit("中文测试abcdef", 10);
        assertTrue(InteractiveSelector.displayWidth(fitted) <= 9);
    }

    @Test
    void fitHandlesAsciiOnly() {
        String fitted = InteractiveSelector.fit("hello world", 5);
        assertEquals("hell", fitted);
    }

    @Test
    void openReturnsCancelledForEmptyOptions() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        InteractiveSelector selector = new InteractiveSelector(new PrintStream(baos), null);
        ChoiceResult result = selector.open(new ChoiceRequest("test", List.of(), true, null));
        assertTrue(result.isCancelled());
    }
}
