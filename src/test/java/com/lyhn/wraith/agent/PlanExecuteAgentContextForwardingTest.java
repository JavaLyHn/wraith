package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.GLMClient;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.plan.Planner;
import org.junit.jupiter.api.Test;

import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

class PlanExecuteAgentContextForwardingTest {

    /**
     * 记录型 Planner 子类：捕获构造期被注入的 conversationContext supplier，
     * 用于断言 PlanExecuteAgent.setConversationContext(...) 确实转发到了 planner。
     */
    private static final class RecordingPlanner extends Planner {
        Supplier<String> captured;

        RecordingPlanner(LlmClient client) {
            super(client);
        }

        @Override
        public void setConversationContextSupplier(Supplier<String> s) {
            this.captured = s;
        }
    }

    @Test
    void setConversationContext_forwardsToPlannerSupplier() {
        LlmClient client = new GLMClient("test-key");
        RecordingPlanner planner = new RecordingPlanner(client);
        // 用 PlanExecuteAgent 包级构造(同包)直接注入自定义 planner；其余参数用最小值。
        PlanExecuteAgent agent = new PlanExecuteAgent(client, null, planner, null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute());

        agent.setConversationContext("CTX-1");

        assertNotNull(planner.captured, "构造应把 supplier 转发给 planner");
        assertEquals("CTX-1", planner.captured.get());
    }

    // ── 执行层(buildExternalContext)也要含主线对话 digest,且不受 MCP 开关 gate ──

    @Test
    void buildExternalContext_whenContextSet_containsConversationDigest() {
        LlmClient client = new GLMClient("test-key");
        PlanExecuteAgent agent = new PlanExecuteAgent(client, null, null, null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute());
        agent.setConversationContext("用户: 我当前在哪个文件夹\n助手: /x/八股");
        String ext = agent.buildExternalContext();
        assertTrue(ext.startsWith(ConversationDigest.INJECT_PREFIX), ext);
        assertTrue(ext.contains("我当前在哪个文件夹"), ext);
    }

    @Test
    void buildExternalContext_whenContextEmpty_noDigestPrefix() {
        LlmClient client = new GLMClient("test-key");
        PlanExecuteAgent agent = new PlanExecuteAgent(client, null, null, null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute());
        String ext = agent.buildExternalContext();
        assertFalse(ext.contains(ConversationDigest.INJECT_PREFIX), ext);
    }
}
