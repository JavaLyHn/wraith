package com.lyhn.wraith.render.inline;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 两横线输入框的提交后行数计算(纯函数,不依赖 Terminal,可在 JDK 26 下运行)。
 *
 * <p>布局:上横线占 {@code leadingLines} 行,其下是 {@code 提示符尾 + 输入} 行(按 cols 折行)。
 * 提示符尾 {@code " › "} = 3 个显示单元。
 */
class InlineInputBoxTest {

    private static final int PROMPT_TAIL = 3; // displayWidth(" › ")
    private static final int RULE = 1;        // 上横线占 1 行

    @Test
    void shortInputIsRulePlusOneLine() {
        assertEquals(2, InlineRenderer.submittedInputRows("hi", PROMPT_TAIL, RULE, 80));
    }

    @Test
    void emptyInputStillCountsRuleAndPromptLine() {
        assertEquals(2, InlineRenderer.submittedInputRows("", PROMPT_TAIL, RULE, 80));
    }

    @Test
    void longInputWrapsThenAddsRule() {
        // 100 + 3 = 103 cells / 80 = 2 行 + 1 横线 = 3
        assertEquals(3, InlineRenderer.submittedInputRows("a".repeat(100), PROMPT_TAIL, RULE, 80));
    }

    @Test
    void multiLineInputCountsEachLinePlusRule() {
        // "a" + "b" 各 1 行 + 1 横线 = 3
        assertEquals(3, InlineRenderer.submittedInputRows("a\nb", PROMPT_TAIL, RULE, 80));
    }

    @Test
    void wideCharsCountDoubleWidth() {
        // "你好" = 4 单元 + 3 = 7 / 80 = 1 行 + 1 横线 = 2
        assertEquals(2, InlineRenderer.submittedInputRows("你好", PROMPT_TAIL, RULE, 80));
    }

    @Test
    void zeroLeadingLinesDegradesToInputRowsOnly() {
        assertEquals(1, InlineRenderer.submittedInputRows("hi", PROMPT_TAIL, 0, 80));
    }
}
