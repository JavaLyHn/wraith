package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SnipPassTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    private static List<Message> historyWithTool(String tool, String content) {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c1",
                new LlmClient.ToolCall.Function(tool, "{}"));
        return new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("do it"),
                Message.assistant("run", List.of(tc)),
                Message.tool("c1", content),
                Message.user("next"),
                Message.assistant("ok")));
    }

    @Test
    void snipsLongToolOutputOutsideProtection() {
        List<Message> h = historyWithTool("grep_code", "L".repeat(5000) + "\n[完整输出: /tmp/x.log]");
        SnipPass.Result r = SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        assertEquals(1, r.changes().size());
        String c = h.get(3).content();
        assertTrue(c.contains(CurationMarks.SNIP_MARK));
        assertTrue(c.contains("[完整输出: /tmp/x.log]"));          // 指针行保留
        assertTrue(c.length() < 1200);
        assertEquals("c1", h.get(3).toolCallId());                 // 协议字段不动
    }

    @Test
    void monotonicSecondRunChangesNothing() {
        List<Message> h = historyWithTool("grep_code", "L".repeat(5000));
        SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        SnipPass.Result second = SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        assertTrue(second.changes().isEmpty());
    }

    @Test
    void protectedToolAndProtectedZoneUntouched() {
        List<Message> h = historyWithTool("load_skill", "S".repeat(5000));
        assertTrue(SnipPass.apply(h, 4, policy, Long.MAX_VALUE).changes().isEmpty());
        List<Message> h2 = historyWithTool("grep_code", "L".repeat(5000));
        assertTrue(SnipPass.apply(h2, 0, policy, Long.MAX_VALUE).changes().isEmpty()); // 全在保护区
    }

    @Test
    void userPlainTextNeverTouchedButHugeCodeblockClipped() {
        String code = "```java\n" + "line;\n".repeat(100) + "```";
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("前言\n" + code + "\n后记"),
                Message.assistant("a"),
                Message.user("tail"), Message.assistant("t")));
        SnipPass.apply(h, 3, policy, Long.MAX_VALUE);
        String c = h.get(1).content();
        assertTrue(c.startsWith("前言"));
        assertTrue(c.endsWith("后记"));
        assertTrue(c.contains(CurationMarks.SNIP_MARK));
        assertTrue(c.lines().count() < 30);
    }

    @Test
    void stopsWhenReleaseTargetReached() {
        LlmClient.ToolCall t1 = new LlmClient.ToolCall("c1", new LlmClient.ToolCall.Function("grep_code", "{}"));
        LlmClient.ToolCall t2 = new LlmClient.ToolCall("c2", new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("u"),
                Message.assistant("a", List.of(t1)), Message.tool("c1", "A".repeat(8000)),
                Message.assistant("a", List.of(t2)), Message.tool("c2", "B".repeat(8000)),
                Message.user("tail"), Message.assistant("t")));
        SnipPass.Result r = SnipPass.apply(h, 6, policy, 100); // 极小目标:第一条就够
        assertEquals(1, r.changes().size());
        assertFalse(h.get(5).content().contains(CurationMarks.SNIP_MARK)); // 第二条未动
    }

    @Test
    void multipleCodeblocksPreserveInterleavedText() {
        // 构造：前言 + 代码块A(≥60行) + 中间文本 + 代码块B(≥60行) + 后记
        String preamble = "块A前言\n";
        String blockA = "```java\n" + "line;\n".repeat(80) + "```";
        String interleaved = "\n块间正文\n";
        String blockB = "```python\n" + "line;\n".repeat(80) + "```";
        String postscript = "\n块B后记";
        String userContent = preamble + blockA + interleaved + blockB + postscript;

        // 构造 history：system / user(待测) / assistant / user tail / assistant
        // protectedFrom=3 让待测 user 在保护区外(index=1 < 3)，可被 snip
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user(userContent),
                Message.assistant("a"),
                Message.user("tail"),
                Message.assistant("t")));

        // 执行 SnipPass
        SnipPass.apply(h, 3, policy, Long.MAX_VALUE);
        String resultContent = h.get(1).content();

        // 断言 1：块外文本完整保留
        assertTrue(resultContent.startsWith("块A前言"), "前言应保留在开头");
        assertTrue(resultContent.contains("块间正文"), "块间正文应完整保留");
        assertTrue(resultContent.endsWith("块B后记"), "后记应保留在结尾");

        // 断言 2：包含截标
        assertTrue(resultContent.contains(CurationMarks.SNIP_MARK), "应包含 SNIP_MARK");

        // 断言 3：代码块被截（总行数明显小于原始）
        long originalLines = userContent.lines().count();
        long resultLines = resultContent.lines().count();
        assertTrue(resultLines < originalLines,
                   "截后行数(" + resultLines + ")应小于原始(" + originalLines + ")");
    }

    @Test
    void skipsLiveSummaryMessageEntirely() {
        // 活摘要是 user 消息且可能含大代码块;snip 见 SUMMARY_MARK 必须整条跳过
        String big = "```java\n" + "int x = 1;\n".repeat(100) + "```";
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n" + big),
                Message.user("q1"), Message.assistant("a1"),
                Message.user("q2"), Message.assistant("a2")));
        SnipPass.Result r = SnipPass.apply(h, h.size(), new ToolTierPolicy(), Long.MAX_VALUE);
        assertTrue(h.get(1).content().contains("int x = 1;"), "活摘要内容不得被截");
        assertTrue(r.changes().stream().noneMatch(c -> c.index() == 1));
    }
}
