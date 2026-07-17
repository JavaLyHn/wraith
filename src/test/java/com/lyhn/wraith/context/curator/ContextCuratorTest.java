package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContextCuratorTest {

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

    private static ContextCurator curator(List<Ev> events, long window) {
        return new ContextCurator(() -> window, new ToolTierPolicy(), CurationSink.NOOP,
                (m, p) -> events.add(new Ev(m, p)));
    }

    @Test
    void belowTier1DoesNothing() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 10_000_000);  // 巨大窗口 → ratio≈0
        List<Message> h = bigHistory();
        assertFalse(c.curate(h, pf -> fail("不该走 tier3")));
        assertTrue(events.isEmpty());
    }

    @Test
    void tier1SnipsAndEmitsCompactionEvent() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 30_000);      // bigHistory 估算远超 60%
        List<Message> h = bigHistory();
        assertTrue(c.curate(h, pf -> {}));
        assertEquals("context.compaction", events.get(events.size() - 1).method());
        Map<String, Object> p = events.get(events.size() - 1).payload();
        assertTrue((int) p.get("snipped") > 0);
        // 至少一条工具输出带了 snip 标
        assertTrue(h.stream().anyMatch(m -> m.content() != null && m.content().contains(CurationMarks.SNIP_MARK)));
    }

    @Test
    void onUsageEmitsWatermarkAndNeverThrows() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 100_000);
        c.onUsage(70_000, 500, 60_000, bigHistory());
        assertEquals("context.watermark", events.get(0).method());
        assertTrue(((Number) events.get(0).payload().get("usedTokens")).longValue() >= 70_000);
    }

    @Test
    void tier3RunsFallbackWhenPassesCannotRelease() {
        // 大头全是保护名单工具(load_skill)→ passes 无从下手 → 仍 ≥95% → 必须走 fallback
        LlmClient.ToolCall tc = new LlmClient.ToolCall("s1", new LlmClient.ToolCall.Function("load_skill", "{}"));
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        h.add(Message.user("start"));
        for (int i = 0; i < 6; i++) {
            h.add(Message.assistant("a", List.of(tc)));
            h.add(Message.tool("s1", "skill-body".repeat(3000)));
        }
        h.add(Message.user("tail"));
        h.add(Message.assistant("done"));
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 12_000);
        boolean[] ran = {false};
        c.curate(h, pf -> ran[0] = true);
        assertTrue(ran[0]);
        // 保护名单未被任何 pass 碰过
        assertTrue(h.stream().noneMatch(m -> m.content() != null && m.content().contains(CurationMarks.SNIP_MARK)));
    }
}
