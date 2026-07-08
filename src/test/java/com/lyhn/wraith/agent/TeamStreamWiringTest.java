package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.GLMClient;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 验证 AgentOrchestrator.setStepStreamFactory 正确向 planner 和每个 step 注入流式监听器。
 * CLI 不回归验证：不设工厂时 streamFor 返回 null，现有 AgentOrchestratorTest 全绿。
 */
class TeamStreamWiringTest {

    @TempDir
    Path tempDir;

    /** 记录工厂被调用时的 (kind, id) 对，并返回 no-op 监听器。 */
    private static class CapturingStreamFactory
            implements BiFunction<String, String, LlmClient.StreamListener> {

        final List<String> calls = new CopyOnWriteArrayList<>();

        @Override
        public LlmClient.StreamListener apply(String kind, String id) {
            calls.add(kind + ":" + id);
            // 返回 no-op 监听器
            return LlmClient.StreamListener.NO_OP;
        }
    }

    @Test
    void 设置工厂后planner和每步均收到监听器() {
        StubGLMClient llm = new StubGLMClient(List.of(
                response("""
                        {
                          "summary": "单步任务",
                          "steps": [
                            {
                              "id": "s1",
                              "description": "执行分析",
                              "type": "ANALYSIS",
                              "dependencies": []
                            }
                          ]
                        }
                        """),
                response("分析结果内容"),
                response("""
                        {"approved": true, "summary": "通过", "issues": []}
                        """)
        ));

        CapturingStreamFactory factory = new CapturingStreamFactory();
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm,
                new ToolRegistry(),
                new NoOpMemoryManager(tempDir.toFile())
        );
        orchestrator.setStepStreamFactory(factory);

        orchestrator.run("测试流式工厂注入");

        // 工厂应被调用：planner + step_1
        assertTrue(factory.calls.contains("planner:planner"),
                "工厂应以 (planner, planner) 被调用，实际调用: " + factory.calls);
        assertTrue(factory.calls.stream().anyMatch(c -> c.startsWith("step:")),
                "工厂应以 (step, <stepId>) 被调用，实际调用: " + factory.calls);
    }

    @Test
    void 不设工厂时streamFor返回null不影响执行() {
        // 不设工厂 → streamFor 返回 null → SubAgent 收到 extra=null → 行为与原签名相同
        StubGLMClient llm = new StubGLMClient(List.of(
                response("""
                        {
                          "summary": "无工厂任务",
                          "steps": [
                            {
                              "id": "s1",
                              "description": "无工厂步骤",
                              "type": "COMMAND",
                              "dependencies": []
                            }
                          ]
                        }
                        """),
                response("执行结果"),
                response("""
                        {"approved": true, "summary": "通过", "issues": []}
                        """)
        ));

        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm,
                new ToolRegistry(),
                new NoOpMemoryManager(tempDir.toFile())
        );
        // 不调用 setStepStreamFactory → streamFactory 为 null

        assertDoesNotThrow(() -> orchestrator.run("无工厂测试"),
                "不设工厂时不应抛出任何异常");
    }

    @Test
    void 两步计划工厂收到planner和两个stepId() {
        StubGLMClient llm = new StubGLMClient(List.of(
                response("""
                        {
                          "summary": "两步任务",
                          "steps": [
                            {
                              "id": "s1",
                              "description": "第一步",
                              "type": "COMMAND",
                              "dependencies": []
                            },
                            {
                              "id": "s2",
                              "description": "第二步",
                              "type": "ANALYSIS",
                              "dependencies": ["s1"]
                            }
                          ]
                        }
                        """),
                response("第一步结果"),
                response("{\"approved\": true, \"summary\": \"通过\", \"issues\": []}"),
                response("第二步结果"),
                response("{\"approved\": true, \"summary\": \"通过\", \"issues\": []}")
        ));

        CapturingStreamFactory factory = new CapturingStreamFactory();
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm,
                new ToolRegistry(),
                new NoOpMemoryManager(tempDir.toFile())
        );
        orchestrator.setStepStreamFactory(factory);

        orchestrator.run("两步工厂测试");

        // planner:planner 必须出现
        assertTrue(factory.calls.contains("planner:planner"),
                "工厂应以 (planner, planner) 被调用，实际: " + factory.calls);

        // 应有两次 step 调用（step_1 和 step_2）
        long stepCalls = factory.calls.stream().filter(c -> c.startsWith("step:")).count();
        assertTrue(stepCalls >= 2,
                "应有至少 2 次 step 调用，实际: " + factory.calls);

        // 确认 step_1 和 step_2 都被调用
        assertTrue(factory.calls.contains("step:step_1"),
                "工厂应以 (step, step_1) 被调用，实际: " + factory.calls);
        assertTrue(factory.calls.contains("step:step_2"),
                "工厂应以 (step, step_2) 被调用，实际: " + factory.calls);
    }

    // ---- helpers ----

    private static LlmClient.ChatResponse response(String content) {
        return new LlmClient.ChatResponse("assistant", content, null, 100, 20);
    }

    private static final class NoOpMemoryManager extends MemoryManager {
        private NoOpMemoryManager(java.io.File storageDir) {
            super(new GLMClient("test-key"), 32768, 200000, new LongTermMemory(storageDir));
        }
    }

    private static final class StubGLMClient extends GLMClient {
        private final Queue<LlmClient.ChatResponse> responses;

        private StubGLMClient(List<LlmClient.ChatResponse> responses) {
            super("test-key");
            this.responses = new ArrayDeque<>(responses);
        }

        @Override
        public LlmClient.ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public LlmClient.ChatResponse chat(List<Message> messages, List<Tool> tools,
                                            StreamListener listener) throws IOException {
            LlmClient.ChatResponse resp = responses.poll();
            if (resp == null) {
                throw new IOException("缺少预设响应");
            }
            if (resp.content() != null && !resp.content().isEmpty()) {
                listener.onContentDelta(resp.content());
            }
            return resp;
        }
    }
}
