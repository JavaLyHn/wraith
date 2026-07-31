package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.llm.LlmClient.ToolCall;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ConversationDigestTest {

    @Test
    void nullOrEmptyOrSystemOnly_returnsEmpty() {
        assertEquals("", ConversationDigest.of(null));
        assertEquals("", ConversationDigest.of(List.of()));
        assertEquals("", ConversationDigest.of(List.of(Message.system("sys"))));
    }

    @Test
    void singleRound_rendersUserAndAssistant_noPrefixInBody() {
        List<Message> h = List.of(
                Message.system("sys"),
                Message.user("克隆这个仓库"),
                Message.assistant("已克隆完成"));
        String d = ConversationDigest.of(h);
        assertTrue(d.contains("用户: 克隆这个仓库"), d);
        assertTrue(d.contains("助手: 已克隆完成"), d);
        assertFalse(d.startsWith(ConversationDigest.INJECT_PREFIX), "digest 主体不含注入前缀");
    }

    @Test
    void keepsOnlyLastMaxRounds_andMarksTruncated() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        for (int i = 1; i <= 6; i++) {
            h.add(Message.user("U" + i));
            h.add(Message.assistant("A" + i));
        }
        String d = ConversationDigest.of(h, 4, 100000);
        assertFalse(d.contains("U1"));
        assertFalse(d.contains("U2"));
        assertTrue(d.contains("U3"));
        assertTrue(d.contains("U6"));
        assertTrue(d.contains("(仅显示最近若干轮)"), d);
    }

    @Test
    void chronologicalOrder_oldestFirst() {
        List<Message> h = List.of(
                Message.user("先做A"), Message.assistant("A完成"),
                Message.user("再做B"), Message.assistant("B完成"));
        String d = ConversationDigest.of(h);
        assertTrue(d.indexOf("先做A") < d.indexOf("再做B"), d);
    }

    @Test
    void toolCallsAndResults_renderedAndTruncated() {
        String bigArgs = "x".repeat(500);
        String bigResult = "y".repeat(500);
        Message asst = Message.assistant("",
                List.of(new ToolCall("t1", new ToolCall.Function("execute_command", bigArgs))));
        List<Message> h = List.of(
                Message.user("跑命令"),
                asst,
                Message.tool("t1", bigResult));
        String d = ConversationDigest.of(h);
        assertTrue(d.contains("[工具 execute_command:"), d);
        assertTrue(d.contains("↳ 结果:"), d);
        assertTrue(d.contains("…"), "超长应截断加省略号");
        // 参数/结果预览不得超过各自上限(+ 省略号)
        assertFalse(d.contains("x".repeat(ConversationDigest.TOOL_ARGS_PREVIEW_CHARS + 1)));
        assertFalse(d.contains("y".repeat(ConversationDigest.TOOL_RESULT_PREVIEW_CHARS + 1)));
    }

    @Test
    void charCap_dropsOldestKeptRounds() {
        List<Message> h = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            h.add(Message.user("U" + i + "-" + "a".repeat(300)));
            h.add(Message.assistant("A" + i));
        }
        String d = ConversationDigest.of(h, 4, 400);
        assertTrue(d.length() <= 400, "总长封顶: " + d.length());
        assertTrue(d.contains("U4"), "最新一轮必须保留");
    }

    @Test
    void prepend_blankContext_returnsBaseByteIdentical() {
        String base = "请为以下任务制定执行计划：\n继续";
        assertSame(base, ConversationDigest.prepend(null, base));
        assertEquals(base, ConversationDigest.prepend("", base));
        assertEquals(base, ConversationDigest.prepend("   ", base));
    }

    @Test
    void prepend_nonBlank_wrapsWithPrefix() {
        String base = "请为以下任务制定执行计划：\n继续";
        String out = ConversationDigest.prepend("用户: 克隆仓库", base);
        assertEquals(ConversationDigest.INJECT_PREFIX + "用户: 克隆仓库" + "\n\n" + base, out);
    }
}
