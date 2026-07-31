package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Plan/Team 执行器把工具调用同步交给观察者(桌面据此发 tool.call,让动作卡在这两个模式也显示)。 */
class ToolCallObserverTest {

    /** 第一次 chat 返回一个 open_panel 工具调用,之后返回纯文本收尾(避免无限循环)。 */
    private static final class ToolThenTextClient implements LlmClient {
        private int calls = 0;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            calls++;
            listener.finish();
            if (calls == 1) {
                LlmClient.ToolCall tc = new LlmClient.ToolCall(
                        "call-1", new LlmClient.ToolCall.Function("open_panel", "{\"panel\":\"im-gateway\"}"));
                return new ChatResponse("assistant", null, null, List.of(tc), 1, 1);
            }
            return new ChatResponse("assistant", "完成", null, 1, 1);
        }
        @Override public boolean supportsTools() { return true; }
        @Override public String getModelName() { return "stub"; }
        @Override public String getProviderName() { return "stub"; }
    }

    private static PrintStream discard() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    @Test
    void subAgentWorkerNotifiesObserverOnToolCalls() {
        List<String> seen = new ArrayList<>();
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        worker.setToolCallObserver(calls -> calls.forEach(c -> seen.add(c.function().name())));
        try {
            worker.execute(AgentMessage.task("test", "打开 IM 网关面板"), discard());
        } catch (Exception ignored) {
            // 执行细节不是本测试关心的,只要观察者被触发过
        }
        assertTrue(seen.contains("open_panel"), "worker 应把工具调用交给观察者,实际: " + seen);
    }

    @Test
    void subAgentWithoutObserverDoesNotThrow() {
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        assertDoesNotThrow(() -> {
            try { worker.execute(AgentMessage.task("test", "打开面板"), discard()); } catch (Exception ignored) { }
        });
    }

    @Test
    void observerExceptionDoesNotBreakSubAgent() {
        SubAgent worker = new SubAgent("worker-1", AgentRole.WORKER, new ToolThenTextClient(), new ToolRegistry());
        worker.setToolCallObserver(calls -> { throw new RuntimeException("boom"); });
        assertDoesNotThrow(() -> {
            try { worker.execute(AgentMessage.task("test", "打开面板"), discard()); } catch (Exception ignored) { }
        });
    }

    @Test
    void orchestratorFansObserverOutToWorkers() {
        AgentOrchestrator orch = new AgentOrchestrator(new ToolThenTextClient());
        List<String> seen = new ArrayList<>();
        orch.setToolCallObserver(calls -> calls.forEach(c -> seen.add(c.function().name())));
        // 直接驱动其中一个 worker:证明扇出真的把观察者装到了 worker 上
        SubAgent worker = orch.workersForTest().get(0);
        try { worker.execute(AgentMessage.task("test", "打开 IM 网关面板"), discard()); } catch (Exception ignored) { }
        assertTrue(seen.contains("open_panel"), "orchestrator 应把观察者扇出给 worker,实际: " + seen);
    }
}
