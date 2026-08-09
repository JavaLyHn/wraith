package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ChoiceModelsTest {

    @Test
    void choiceOption_holdsLabelAndDescription() {
        ChoiceOption opt = new ChoiceOption("方案A", "用 JLine 实现");
        assertEquals("方案A", opt.label());
        assertEquals("用 JLine 实现", opt.description());
    }

    @Test
    void choiceOption_descriptionCanBeNullOrEmpty() {
        ChoiceOption opt1 = new ChoiceOption("简单选项", null);
        assertNull(opt1.description());
        ChoiceOption opt2 = new ChoiceOption("简单选项", "");
        assertEquals("", opt2.description());
    }

    @Test
    void choiceRequest_holdsAllFields() {
        List<ChoiceOption> opts = List.of(
            new ChoiceOption("A", null),
            new ChoiceOption("B", "desc")
        );
        ChoiceRequest req = new ChoiceRequest("选择", opts, true, "提示文本");
        assertEquals("选择", req.title());
        assertEquals(2, req.options().size());
        assertTrue(req.allowCancel());
        assertEquals("提示文本", req.hint());
    }

    @Test
    void choiceResult_selectedIndexAndCancelled() {
        ChoiceResult confirmed = new ChoiceResult(2, false);
        assertEquals(2, confirmed.selectedIndex());
        assertFalse(confirmed.isCancelled());

        ChoiceResult cancelled = new ChoiceResult(-1, true);
        assertEquals(-1, cancelled.selectedIndex());
        assertTrue(cancelled.isCancelled());
    }

    @Test
    void choiceResult_factoryCancelled() {
        ChoiceResult result = ChoiceResult.cancelled();
        assertTrue(result.isCancelled());
        assertEquals(-1, result.selectedIndex());
    }

    @Test
    void choiceResult_factorySelected() {
        ChoiceResult result = ChoiceResult.selected(1);
        assertFalse(result.isCancelled());
        assertEquals(1, result.selectedIndex());
    }
}
