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
}
