package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AgentOrchestratorContextInjectionTest {

    /** 捕获第一次 chat() 的出站 messages,返回空计划(让 run 尽快收尾/或抛错由调用方吞)。 */
    private static final class RecordingClient implements LlmClient {
        List<Message> firstMessages = null;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (firstMessages == null) firstMessages = new ArrayList<>(messages);
            listener.finish();
            return new ChatResponse("assistant", "{}", null, 1, 1);
        }
        @Override public String getModelName() { return "stub"; }
        @Override public String getProviderName() { return "stub"; }
    }

    private static String plannerTaskText(RecordingClient c) {
        // planner 任务在最后一条 user 消息(system 是角色提示词)
        Message last = c.firstMessages.get(c.firstMessages.size() - 1);
        return last.content();
    }

    @Test
    void whenContextSet_plannerTaskContainsInjectedBlock() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        orch.setConversationContext("用户: 克隆仓库\n助手: 已完成");
        try { orch.run("继续"); } catch (Exception ignored) { }
        String task = plannerTaskText(c);
        assertTrue(task.startsWith(ConversationDigest.INJECT_PREFIX), task);
        assertTrue(task.contains("用户: 克隆仓库"), task);
        assertTrue(task.endsWith("请为以下任务制定执行计划：\n继续"), task);
    }

    @Test
    void whenContextEmpty_plannerTaskByteIdenticalToBaseline() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        // 不调 setConversationContext,或设空
        orch.setConversationContext("");
        try { orch.run("继续"); } catch (Exception ignored) { }
        assertEquals("请为以下任务制定执行计划：\n继续", plannerTaskText(c));
    }

    // ── worker 执行层也要拿到主线对话 digest(修复:切模式后 worker 曾看不到前文) ──

    @Test
    void buildStepContext_whenContextSet_containsConversationDigest() {
        AgentOrchestrator orch = new AgentOrchestrator(new RecordingClient());
        orch.setConversationContext("用户: 克隆仓库\n助手: 已完成");
        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "跑命令", "command", List.of()));
        assertTrue(ctx.startsWith(ConversationDigest.INJECT_PREFIX), ctx);
        assertTrue(ctx.contains("用户: 克隆仓库"), ctx);
        assertTrue(ctx.contains("总任务上下文"), ctx);
    }

    @Test
    void buildStepContext_whenContextEmpty_noDigestPrefix() {
        AgentOrchestrator orch = new AgentOrchestrator(new RecordingClient());
        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "跑命令", "command", List.of()));
        assertFalse(ctx.contains(ConversationDigest.INJECT_PREFIX), ctx);
        assertTrue(ctx.startsWith("总任务上下文"), ctx);
    }
}
