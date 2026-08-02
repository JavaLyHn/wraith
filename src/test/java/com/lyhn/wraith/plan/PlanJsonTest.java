package com.lyhn.wraith.plan;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 从 LLM 输出里抠出计划 JSON。
 *
 * <p><b>起因</b>：用户在 Plan 模式下问「我刚问了什么」，界面上冒出
 *
 * <pre>❌ 执行失败: Unrecognized token '根据对话历史': was expecting (JSON String, Number,
 * Array, Object or token 'null', 'true' or 'false') at [Source: REDACTED …]; line: 1, column: 7</pre>
 *
 * <p>模型没做错什么——它被问了一个问题，就用自然语言回答了。做错的是我们：
 * {@code Planner.parsePlan} 把模型输出**原样**丢给 {@code mapper.readTree}，
 * 于是 Jackson 的内部错误直接糊到用户脸上。而这段散文里往往就藏着用户真正想要的答案。
 *
 * <p><b>而且同一个修复此前只打了一半</b>：Team 模式的
 * {@code AgentOrchestrator.parsePlan} 早就有「剥离 JSON 前后自然语言」的逻辑
 * （first {@code &#123;} → last {@code &#125;}），Plan 模式的 {@code Planner} 没有。
 * 抽成这一份共用实现，就是不想再有第三处各写一遍。
 *
 * <p><b>为什么不用 first-&#123; / last-&#125;</b>：那个写法会被散文里的花括号骗到
 * （「计划如下：{...}，祝顺利 :&#125;」会把结尾也吞进去）。这里做括号配平扫描，
 * 且认得字符串字面量与转义——JSON 值里出现 <code>&#125;</code> 是家常便饭。
 */
class PlanJsonTest {

    // ── 正常路径 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("裸 JSON 原样取出")
    void plainJson() {
        String raw = "{\"summary\":\"s\",\"tasks\":[]}";
        assertEquals(raw, PlanJson.extract(raw));
    }

    @Test
    @DisplayName("```json 围栏")
    void fencedJson() {
        String raw = "```json\n{\"tasks\":[1]}\n```";
        assertEquals("{\"tasks\":[1]}", PlanJson.extract(raw));
    }

    @Test
    @DisplayName("无语言标记的 ``` 围栏")
    void barefence() {
        assertEquals("{\"a\":1}", PlanJson.extract("```\n{\"a\":1}\n```"));
    }

    @Test
    @DisplayName("JSON 前后都有自然语言 —— 这正是 planner 最常见的输出形态")
    void proseAround() {
        String raw = "好的，计划如下：\n{\"tasks\":[{\"id\":\"t1\"}]}\n希望有帮助！";
        assertEquals("{\"tasks\":[{\"id\":\"t1\"}]}", PlanJson.extract(raw));
    }

    @Test
    @DisplayName("尾部散文里还有花括号 —— first{/last} 会吞掉它,配平扫描不会")
    void trailingBraceInProse() {
        String raw = "计划：{\"tasks\":[]} 祝顺利 :}";
        assertEquals("{\"tasks\":[]}", PlanJson.extract(raw));
    }

    @Test
    @DisplayName("字符串字面量里的花括号不参与配平")
    void bracesInsideStrings() {
        String raw = "{\"summary\":\"把 {x} 改成 }y{\",\"tasks\":[]}";
        assertEquals(raw, PlanJson.extract(raw));
    }

    @Test
    @DisplayName("转义引号不会让扫描误以为字符串结束")
    void escapedQuote() {
        String raw = "{\"summary\":\"他说\\\"好\\\"}\",\"tasks\":[]}";
        assertEquals(raw, PlanJson.extract(raw));
    }

    @Test
    @DisplayName("嵌套对象整体取出,不在第一个内层 } 就收手")
    void nested() {
        String raw = "前言 {\"a\":{\"b\":{\"c\":1}},\"tasks\":[]} 后记";
        assertEquals("{\"a\":{\"b\":{\"c\":1}},\"tasks\":[]}", PlanJson.extract(raw));
    }

    // ── 「根本没有 JSON」——本次 bug 的主场 ──────────────────────────────────

    @Test
    @DisplayName("纯自然语言 → null(不是坏 JSON,是压根没 JSON,两者要分开)")
    void proseOnly() {
        assertNull(PlanJson.extract("根据对话历史，你最后问的是：**\"有哪些文件\"**"));
    }

    @Test
    @DisplayName("空 / null / 空白 → null")
    void empties() {
        assertNull(PlanJson.extract(null));
        assertNull(PlanJson.extract(""));
        assertNull(PlanJson.extract("   \n\t "));
    }

    @Test
    @DisplayName("只有左括号没有配对的右括号(输出被截断)→ null,不返回半截")
    void unbalanced() {
        assertNull(PlanJson.extract("计划：{\"tasks\":[{\"id\":\"t1\""));
    }

    @Test
    @DisplayName("只有数组不算计划 —— 计划的顶层约定是对象")
    void topLevelArrayIsNotAPlan() {
        assertNull(PlanJson.extract("[{\"id\":\"t1\"}]"));
    }

    // ── 给用户看的话 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("失败文案要说清「发生了什么 + 下一步怎么办」,而不是抛 Jackson 内部错")
    void message() {
        String prose = "根据对话历史，你最后问的是：有哪些文件";
        String msg = PlanJson.noPlanMessage(prose);

        assertTrue(msg.contains("ReAct"), "得告诉用户切回哪个模式: " + msg);
        assertFalse(msg.contains("Unrecognized token"), "不许再把 Jackson 的话搬给用户");
        assertFalse(msg.contains("JsonParseException"), msg);
    }

    @Test
    @DisplayName("**保留模型原话** —— 它往往就是用户真正想要的答案(截图里那次就是对的)")
    void keepsModelProse() {
        String prose = "根据对话历史，你最后问的是：有哪些文件";
        assertTrue(PlanJson.noPlanMessage(prose).contains("有哪些文件"));
    }

    @Test
    @DisplayName("超长输出要截断,不能把几千字糊满整屏")
    void truncatesLongProse() {
        String msg = PlanJson.noPlanMessage("啊".repeat(5000));
        assertTrue(msg.length() < 1200, "实际长度 " + msg.length());
        assertTrue(msg.contains("…"), "截断要有省略号提示: " + msg);
    }

    @Test
    @DisplayName("模型什么都没说时也给得出话,不 NPE")
    void nullProse() {
        assertNotNull(PlanJson.noPlanMessage(null));
        assertNotNull(PlanJson.noPlanMessage(""));
    }
}
