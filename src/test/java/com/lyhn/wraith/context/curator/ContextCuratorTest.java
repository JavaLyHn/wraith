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
        int eventsBeforeCooldownRounds = events.size();
        c.curate(h);
        c.curate(h);
        assertEquals(1, fs.calls, "cooldown 期间 summarize 不得重试");
        // Fix 2: 冷却轮零变更(已全压过/无可再压,round3 保护区永远落不下 tier3)也不许静默——必须留痕
        assertTrue(events.size() > eventsBeforeCooldownRounds,
                "cooldown 零变更轮也应发 context.compaction 事件,不许静默");
        Map<String, Object> coolEvt = lastEvent("context.compaction");
        assertEquals("cooldown", coolEvt.get("fallback"));
        assertEquals(0, coolEvt.get("snipped"));
        assertEquals(0, coolEvt.get("pruned"));
        assertEquals(false, coolEvt.get("summarized"));
    }

    @Test
    void resetConversationStateEndsCooldownAndAllowsImmediateRetry() {
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<Message> h = bigHistory();
        c.curate(h);
        assertEquals(1, fs.calls);
        assertEquals("emergency", lastEvent("context.compaction").get("fallback"));
        // 未复位:冷却期内 curate 不再调用 summarize
        c.curate(h);
        assertEquals(1, fs.calls);
        // 会话边界复位(对应 Agent.clearHistory/restoreHistory):冷却清零,下一轮立即重试摘要
        c.resetConversationState();
        c.curate(h);
        assertEquals(2, fs.calls, "resetConversationState 后应立即重试摘要,不再受旧会话冷却压制");
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
        assertTrue(c.compactNow(h).any());
        assertEquals(1, fs.calls, "手动压缩必须走到摘要");
    }

    @Test
    void manualCompactFailureFallsBackAndReports() {
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<Message> h = bigHistory();
        ContextCurator.ManualCompaction r = c.compactNow(h);
        assertEquals(1, fs.calls);
        assertTrue(r.any(), "snip/prune 有动作");
        assertFalse(r.summarized());
        assertEquals("emergency", r.fallback(), "摘要失败必须走兜底并如实回报");
        Map<String, Object> evt = lastEvent("context.compaction");
        assertEquals(true, evt.get("manual"));
        assertEquals("emergency", evt.get("fallback"));
        // 失败进入 cooldown:随后自动 curate 冷却期内不再调 LLM
        c.curate(h);
        assertEquals(1, fs.calls, "manual 失败也应进入 cooldown");
    }

    @Test
    void cooldownExpiryRetriesSummarizeEndToEnd() {
        // spec §7 顺带补:Phase B 留档的 cooldown 到期重试 e2e——默认 cooldown=3,
        // 失败轮 + 3 个冷却轮之后,第 5 次 curate 必须重试 summarize
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<Message> h = bigHistory();
        c.curate(h);                       // 失败,calls=1,cooldown=3
        c.curate(h); c.curate(h); c.curate(h);   // 冷却 3→2→1→0,不调 LLM
        assertEquals(1, fs.calls);
        c.curate(h);                       // 冷却耗尽,重试
        assertEquals(2, fs.calls, "cooldown 到期后必须重试摘要");
    }

    @Test
    void manualCompactSuccessReportsSummarizedNoFallback() {
        FakeSummarizer fs = new FakeSummarizer(true);
        ContextCurator c = curatorWith(fs);
        ContextCurator.ManualCompaction r = c.compactNow(bigHistory());
        assertTrue(r.any());
        assertTrue(r.summarized());
        assertNull(r.fallback(), "成功路径 fallback 必须为 null");
        assertNull(lastEvent("context.compaction").get("fallback"), "成功事件不带 fallback 键");
    }

    @Test
    void manualCompactReturnValueTokensMatchEmittedEvent() {
        // bug#2:横幅(取 ManualCompaction.before/after)与压缩历史(取 context.compaction 事件)
        // 必须同源一致——此前 Agent 另用 estimateCurrentContextTokens() 造成两套数字打架。
        FakeSummarizer fs = new FakeSummarizer(true);
        ContextCurator c = curatorWith(fs);
        ContextCurator.ManualCompaction r = c.compactNow(bigHistory());
        Map<String, Object> evt = lastEvent("context.compaction");
        assertEquals(((Number) evt.get("beforeTokens")).longValue(), r.beforeTokens(),
                "返回值 beforeTokens 必须等于事件里的 beforeTokens");
        assertEquals(((Number) evt.get("afterTokens")).longValue(), r.afterTokens(),
                "返回值 afterTokens 必须等于事件里的 afterTokens");
    }

    @Test
    void manualCompactOnShortHistoryStillReportsAndEmits() {
        // 短会话:全在保护区,snip/prune/EMERGENCY 均零变更,摘要 false →
        // 防静默:仍须 any=true、发事件带 fallback,绝不返回自相矛盾的 (false,·,"emergency")
        FakeSummarizer fs = new FakeSummarizer(false);
        ContextCurator c = curatorWith(fs);
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("q1"), Message.assistant("a1"),
                Message.user("q2"), Message.assistant("a2")));
        ContextCurator.ManualCompaction r = c.compactNow(h);
        assertTrue(r.any(), "fallback 轮零变更也不许静默");
        assertEquals("emergency", r.fallback());
        Map<String, Object> evt = lastEvent("context.compaction");
        assertEquals(true, evt.get("manual"));
        assertEquals("emergency", evt.get("fallback"));
    }
}
