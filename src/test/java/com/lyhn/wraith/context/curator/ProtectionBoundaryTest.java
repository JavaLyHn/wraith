package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ProtectionBoundaryTest {

    private static Message user(String s) { return Message.user(s); }
    private static Message asst(String s) { return Message.assistant(s); }

    @Test
    void budgetClampsForSmallWindows() {
        assertEquals(12_000, ProtectionBoundary.protectedBudget(128_000));
        assertEquals(2_000, ProtectionBoundary.protectedBudget(8_000)); // 8k/4
    }

    @Test
    void protectsAtLeastLastTwoUserRounds() {
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                user("r1"), asst("a1"),
                user("r2"), asst("a2"),
                user("r3"), asst("a3")));
        // 预算极小(1 token)也必须至少保住最近 2 个 user 轮 → 边界落在 "r2"(index 3)
        assertEquals(3, ProtectionBoundary.protectedFrom(h, 1));
    }

    @Test
    void boundaryExpandsBackToUserEdge() {
        // 大预算把累计推进到中段的 assistant 上 → 必须外扩到其前最近 user
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                user("x".repeat(4000)), asst("y".repeat(4000)),
                user("tail1"), asst("t"), user("tail2"), asst("t")));
        int from = ProtectionBoundary.protectedFrom(h, 3_000);
        assertEquals("user", h.get(from).role());
    }

    @Test
    void toolNamesByIdWalksAssistantToolCalls() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("id-1",
                new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = List.of(
                Message.assistant("do", List.of(tc)),
                Message.tool("id-1", "result"));
        assertEquals("grep_code", ProtectionBoundary.toolNamesById(h).get("id-1"));
    }
}
