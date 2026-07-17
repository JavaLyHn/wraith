package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class PrunePassTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    @Test
    void snippedToolBecomesPlaceholderKeepingPointer() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c1", new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant("a", List.of(tc)),
                Message.tool("c1", "head..." + CurationMarks.SNIP_MARK + "[原 9000 字符已截]\n"
                        + CurationMarks.LOG_POINTER_PREFIX + "/tmp/x.log]"),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 4, policy, Long.MAX_VALUE);
        String c = h.get(3).content();
        assertTrue(c.contains(CurationMarks.PRUNE_MARK));
        assertTrue(c.contains("/tmp/x.log"));
        assertFalse(c.contains("head..."));
    }

    @Test
    void longAssistantTextTrimmedButToolCallsPreserved() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c9", new LlmClient.ToolCall.Function("read_file", "{}"));
        String longText = "第一句。第二句。" + "废话".repeat(2000);
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant(longText, List.of(tc)),
                Message.tool("c9", "r"),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 4, policy, Long.MAX_VALUE);
        Message pruned = h.get(2);
        assertTrue(pruned.content().contains(CurationMarks.PRUNE_MARK));
        assertTrue(pruned.content().length() < 400);
        assertNotNull(pruned.toolCalls());
        assertEquals("c9", pruned.toolCalls().get(0).id());
    }

    @Test
    void monotonicAndProtectedZoneUntouched() {
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant("长".repeat(3000)),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 3, policy, Long.MAX_VALUE);
        assertTrue(PrunePass.apply(h, 3, policy, Long.MAX_VALUE).changes().isEmpty()); // 二遍零变更
        List<Message> h2 = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"), Message.assistant("长".repeat(3000))));
        assertTrue(PrunePass.apply(h2, 1, policy, Long.MAX_VALUE).changes().isEmpty()); // 全保护
    }

    @Test
    void skipsMessageCarryingSummaryMark() {
        // 防御:任何带 SUMMARY_MARK 的消息(即使 assistant 长文)prune 不碰
        String longText = ("句子。").repeat(400) + CurationMarks.SUMMARY_MARK;
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.assistant(longText),
                Message.user("q1"), Message.assistant("a1"),
                Message.user("q2"), Message.assistant("a2")));
        SnipPass.Result r = PrunePass.apply(h, h.size(), new ToolTierPolicy(), Long.MAX_VALUE);
        assertEquals(longText, h.get(1).content());
        assertTrue(r.changes().isEmpty());
    }

    @Test
    void emergencyPrunesUnsnippedSmallToolOutputs() {
        // 500 字符工具输出:不够 SNIP_MIN_CHARS(1500)永远不会被 snip,常规 prune 也不碰;
        // EMERGENCY 必须能压成占位符——这是 tier3 失败兜底的真实增量空间
        List<LlmClient.ToolCall> tcs = List.of(new LlmClient.ToolCall("c1",
                new LlmClient.ToolCall.Function("grep_code", "{}")));
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.assistant(null, null, tcs),
                Message.tool("c1", "x".repeat(500)),
                Message.user("q1"), Message.assistant("a1"),
                Message.user("q2"), Message.assistant("a2")));
        // 常规档不动它
        SnipPass.Result normal = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE);
        assertTrue(normal.changes().isEmpty());
        // EMERGENCY 压掉
        SnipPass.Result em = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
        assertEquals(1, em.changes().size());
        assertTrue(h.get(2).content().contains(CurationMarks.PRUNE_MARK));
        // 单调:第二遍零变更
        SnipPass.Result again = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
        assertTrue(again.changes().isEmpty());
    }

    @Test
    void emergencyPrunesShorterAssistantButKeepsRedlines() {
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.assistant("这是一段三百字的助手输出。" + "补充内容。".repeat(60)),  // >200 chars, <1200 chars
                Message.user("用户纯文本,一字不动"),
                Message.user("q2"), Message.assistant("a2"),
                Message.user("q3"), Message.assistant("a3")));
        SnipPass.Result em = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
        assertTrue(h.get(1).content().contains(CurationMarks.PRUNE_MARK), "300字 assistant 在 EMERGENCY 应被裁");
        assertEquals("用户纯文本,一字不动", h.get(2).content(), "用户纯文本任何档不动");
        assertEquals(1, em.changes().size());
    }
}
