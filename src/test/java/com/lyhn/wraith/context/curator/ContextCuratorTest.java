package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContextCuratorTest {

    private final List<Ev> events = new ArrayList<>();

    private static List<Message> bigHistory() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        for (int round = 0; round < 4; round++) {
            h.add(Message.user("round " + round));
            LlmClient.ToolCall tc = new LlmClient.ToolCall("c" + round,
                    new LlmClient.ToolCall.Function("grep_code", "{}"));
            h.add(Message.assistant("searching", List.of(tc)));
            h.add(Message.tool("c" + round, ("match-" + round + " ").repeat(2500)));
        }
        h.add(Message.user("tail"));
        h.add(Message.assistant("done"));
        return h;
    }

    record Ev(String method, Map<String, Object> payload) {}

    /** 可控假摘要器 */
    private static class FakeSummarizer extends IncrementalSummarizer {
        boolean succeed; int calls = 0;
        FakeSummarizer(boolean succeed) {
            super(() -> null, new CalibratedTokenCounter());
            this.succeed = succeed;
        }
        @Override public boolean summarize(List<Message> h, int pf, String m, long w) {
            calls++;
            if (!succeed) return false;
            h.subList(1, Math.max(1, pf)).clear();
            h.add(1, Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\nS"));
            return true;
        }
    }

    private ContextCurator curator(long window) {
        return new ContextCurator(() -> window, () -> "test-model", () -> null, new ToolTierPolicy(), CurationSink.NOOP,
                (m, p) -> events.add(new Ev(m, p)));
    }

    /** 窗口小到 bigHistory() 压完仍必落 tier3(round3 保护区内的大工具输出永远压不动)。 */
    private ContextCurator curatorWith(IncrementalSummarizer summarizer) {
        return new ContextCurator(() -> 5_000L, () -> "test-model", () -> null, new ToolTierPolicy(), CurationSink.NOOP,
                (m, p) -> events.add(new Ev(m, p)), summarizer);
    }

    private Map<String, Object> lastEvent(String method) {
        for (int i = events.size() - 1; i >= 0; i--) {
            if (method.equals(events.get(i).method())) return events.get(i).payload();
        }
        throw new AssertionError("no event recorded for " + method);
    }

    @Test
    void belowTier1DoesNothing() {
        ContextCurator c = curator(10_000_000);  // 巨大窗口 → ratio≈0
        List<Message> h = bigHistory();
        assertFalse(c.curate(h));
        assertTrue(events.isEmpty());
    }

    @Test
    void tier1SnipsAndEmitsCompactionEvent() {
        ContextCurator c = curator(30_000);      // bigHistory 估算远超 60%
        List<Message> h = bigHistory();
        assertTrue(c.curate(h));
        Map<String, Object> p = lastEvent("context.compaction");
        assertTrue((int) p.get("snipped") > 0);
        // 至少一条工具输出带了 snip 标
        assertTrue(h.stream().anyMatch(m -> m.content() != null && m.content().contains(CurationMarks.SNIP_MARK)));
    }

    @Test
    void onUsageEmitsWatermarkAndNeverThrows() {
        ContextCurator c = curator(100_000);
        c.onUsage(70_000, 500, 60_000, bigHistory());
        assertEquals("context.watermark", events.get(0).method());
        assertTrue(((Number) events.get(0).payload().get("usedTokens")).longValue() >= 70_000);
    }

    @Test
    void tier3SuccessEmitsSummarizedEvent() {
        FakeSummarizer fs = new FakeSummarizer(true);
        ContextCurator c = curatorWith(fs);          // 辅助:窗口小到必 tier3
        List<Message> h = bigHistory();
        assertTrue(c.curate(h));
        assertEquals(1, fs.calls);
        assertTrue(lastEvent("context.compaction").get("summarized").equals(true));
    }

    @Test
    void tier3FailureRunsEmergencyAndCoolsDown() {
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<Message> h = bigHistory();
        c.curate(h);
        assertEquals(1, fs.calls);
        Map<String, Object> evt = lastEvent("context.compaction");
        assertEquals(false, evt.get("summarized"));
        assertEquals("emergency", evt.get("fallback"));
        // 冷却期内不再调 LLM 摘要
        c.curate(h);
        c.curate(h);
        assertEquals(1, fs.calls, "cooldown 期间 summarize 不得重试");
    }

    @Test
    void pressureNoticeFiresOnceWhenNothingReleasable() {
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<String> notices = new ArrayList<>();
        c.setNoticeOut(notices::add);
        List<Message> h = bigHistory();
        c.curate(h);
        c.curate(h);
        assertEquals(1, notices.size(), "压不动提示只发一次");
    }

    @Test
    void manualCompactNowRunsFullPipeline() {
        FakeSummarizer fs = new FakeSummarizer(true);
        ContextCurator c = curatorWith(fs);
        List<Message> h = bigHistory();
        assertTrue(c.compactNow(h));
        assertEquals(1, fs.calls, "手动压缩必须走到摘要");
    }
}
