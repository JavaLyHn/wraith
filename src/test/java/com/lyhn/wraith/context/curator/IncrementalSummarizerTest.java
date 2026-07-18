package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class IncrementalSummarizerTest {

    /** 测试桩:callLlm 返回固定摘要并捕获 prompt。 */
    private static class Stub extends IncrementalSummarizer {
        final AtomicReference<String> lastPrompt = new AtomicReference<>();
        private final String reply;
        Stub(String reply) {
            super(() -> null, new CalibratedTokenCounter());
            this.reply = reply;
        }
        @Override protected String callLlm(String prompt) throws IOException {
            lastPrompt.set(prompt);
            if (reply == null) throw new IOException("LLM down");
            return reply;
        }
    }

    private static List<Message> historyOf6Rounds() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        for (int i = 0; i < 6; i++) {
            h.add(Message.user("Q" + i + " " + "内容。".repeat(500)));
            h.add(Message.assistant("A" + i));
        }
        return h;
    }

    @Test
    void firstSummarizeReplacesDeltaWithMarkedSummary() {
        List<Message> h = historyOf6Rounds();
        int protectedFrom = 9;    // Q4 起保护(index: sys=0, Q0=1..A5=12 → Q4=9)
        Stub s = new Stub("四段摘要内容");
        assertTrue(s.summarize(h, protectedFrom, "m", 128_000));
        // 形态: [sys][summary][ack][Q4][A4][Q5][A5]
        assertEquals(7, h.size());
        assertTrue(h.get(1).content().contains(CurationMarks.SUMMARY_MARK));
        assertTrue(h.get(1).content().contains("四段摘要内容"));
        assertEquals("assistant", h.get(2).role());
        assertTrue(h.get(3).content().startsWith("Q4"));
    }

    @Test
    void secondSummarizeMergesOldSummaryIntoPrompt() {
        List<Message> h = historyOf6Rounds();
        Stub s1 = new Stub("旧摘要ABC");
        assertTrue(s1.summarize(h, 9, "m", 128_000));
        // 再堆两轮,活摘要在 index 1
        h.add(Message.user("Q6 " + "更多。".repeat(500)));
        h.add(Message.assistant("A6"));
        Stub s2 = new Stub("合并后新摘要");
        int protectedFrom2 = h.size() - 2;   // 只保 Q6 轮
        assertTrue(s2.summarize(h, protectedFrom2, "m", 128_000));
        assertTrue(s2.lastPrompt.get().contains("旧摘要ABC"), "旧活摘要必须进合并 prompt");
        assertFalse(s2.lastPrompt.get().contains("[活摘要]"), "活摘要标签不应残留混入合并 prompt");
        assertTrue(h.get(1).content().contains("合并后新摘要"));
        assertFalse(h.get(1).content().contains("旧摘要ABC"), "旧摘要消息已被替换");
    }

    @Test
    void failureLeavesHistoryUntouched() {
        List<Message> h = historyOf6Rounds();
        List<Message> snapshot = new ArrayList<>(h);
        Stub s = new Stub(null);   // 抛 IOException
        assertFalse(s.summarize(h, 9, "m", 128_000));
        assertEquals(snapshot, h);
    }

    @Test
    void blankSummaryAborts() {
        List<Message> h = historyOf6Rounds();
        int before = h.size();
        Stub s = new Stub("   ");
        assertFalse(s.summarize(h, 9, "m", 128_000));
        assertEquals(before, h.size());
    }

    @Test
    void oversizedDeltaIsSlicedAtUserBoundaryOldestFirst() {
        List<Message> h = historyOf6Rounds();
        // 压小输入预算:window 很小 → budget 只装得下前几轮
        System.setProperty("wraith.context.summary.inputCap", "800");
        try {
            Stub s = new Stub("部分摘要");
            assertTrue(s.summarize(h, 11, "m", 128_000));   // 保护 Q5 起
            // 剩余 delta 应还有原文轮次留在 history(未被一次吞完)
            boolean hasRawRounds = h.stream().anyMatch(m ->
                    m.content() != null && m.content().startsWith("Q") && !m.content().startsWith("Q5"));
            assertTrue(hasRawRounds, "超预算时应只吞最老的一段,剩余留给下轮");
            assertTrue(h.get(1).content().contains(CurationMarks.SUMMARY_MARK));
        } finally {
            System.clearProperty("wraith.context.summary.inputCap");
        }
    }

    @Test
    void noUserBoundaryInBudgetAborts() {
        // 首条 delta 消息单条超预算且后面没有 user 边界可切 → 放弃不改写
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        h.add(Message.user("Q0 " + "巨量内容。".repeat(5000)));
        h.add(Message.assistant("A0"));
        h.add(Message.user("Q1"));
        h.add(Message.assistant("A1"));
        System.setProperty("wraith.context.summary.inputCap", "100");
        try {
            Stub s = new Stub("摘要");
            int before = h.size();
            assertFalse(s.summarize(h, 3, "m", 128_000));
            assertEquals(before, h.size());
        } finally {
            System.clearProperty("wraith.context.summary.inputCap");
        }
    }

    @Test
    void protectedTailAndToolPairsSurvive() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        h.add(Message.user("Q0 " + "老内容。".repeat(500)));
        h.add(Message.assistant("A0"));
        h.add(Message.user("Q1"));
        List<LlmClient.ToolCall> tcs = List.of(new LlmClient.ToolCall("c1",
                new LlmClient.ToolCall.Function("read_file", "{}")));
        h.add(Message.assistant(null, null, tcs));
        h.add(Message.tool("c1", "file content"));
        h.add(Message.assistant("done"));
        Stub s = new Stub("摘要");
        assertTrue(s.summarize(h, 3, "m", 128_000));   // 保护 Q1 起
        // 尾部 [Q1][assistant+tc][tool][assistant] 完整保留
        int qi = -1;
        for (int i = 0; i < h.size(); i++) if ("Q1".equals(h.get(i).content())) qi = i;
        assertTrue(qi > 0);
        assertNotNull(h.get(qi + 1).toolCalls());
        assertEquals("tool", h.get(qi + 2).role());
    }
}
