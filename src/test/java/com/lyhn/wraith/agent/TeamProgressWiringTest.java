package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.GLMClient;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TeamProgressListener 回调接线验证。
 * 断言单步串行路径下的回调序列：
 *   started → planParsed(非空) → stepStarted → stepCompleted(completed, approved=true) → finished("completed")
 */
class TeamProgressWiringTest {

    @TempDir
    Path tempDir;

    /**
     * 捕获型 listener，把每次回调以字符串追加到 events 列表，方便断言顺序。
     */
    private static class CapturingListener implements TeamProgressListener {
        final List<String> events = new ArrayList<>();

        @Override
        public void started(String goal, List<AgentInfo> agents) {
            events.add("started:" + goal);
        }

        @Override
        public void planParsed(List<StepInfo> steps) {
            events.add("planParsed:" + steps.size());
        }

        @Override
        public void batchStarted(int batchIndex, List<String> stepIds) {
            events.add("batchStarted:" + batchIndex + ":" + stepIds.size());
        }

        @Override
        public void stepStarted(String stepId, String agentName) {
            events.add("stepStarted:" + stepId);
        }

        @Override
        public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {
            events.add("stepCompleted:" + stepId + ":" + status + ":approved=" + approved);
        }

        @Override
        public void finished(String status) {
            events.add("finished:" + status);
        }
    }

    @Test
    void 单步计划触发完整回调序列_started_planParsed_stepStarted_stepCompleted_finished() {
        // StubGLMClient 响应队列：planner JSON 计划 → worker 执行结果 → reviewer 通过
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

        CapturingListener listener = new CapturingListener();
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm,
                new ToolRegistry(),
                new NoOpMemoryManager(tempDir.toFile())
        );
        orchestrator.setProgressListener(listener);

        orchestrator.run("测试回调序列");

        List<String> events = listener.events;
        // 1. started 必须是第一个
        assertTrue(events.get(0).startsWith("started:"), "首个事件应为 started, 实际: " + events);

        // 2. planParsed 在 started 之后，且 steps > 0
        int planParsedIdx = indexOfPrefix(events, "planParsed:");
        assertTrue(planParsedIdx > 0, "planParsed 应在 started 之后: " + events);
        assertTrue(events.get(planParsedIdx).contains(":1"), "planParsed 应包含 1 个步骤: " + events);

        // 3. stepStarted 存在
        int stepStartedIdx = indexOfPrefix(events, "stepStarted:");
        assertTrue(stepStartedIdx > planParsedIdx, "stepStarted 应在 planParsed 之后: " + events);

        // 4. stepCompleted 存在且 approved=true
        int stepCompletedIdx = indexOfPrefix(events, "stepCompleted:");
        assertTrue(stepCompletedIdx > stepStartedIdx, "stepCompleted 应在 stepStarted 之后: " + events);
        assertTrue(events.get(stepCompletedIdx).contains("approved=true"),
                "stepCompleted 应 approved=true: " + events);
        assertTrue(events.get(stepCompletedIdx).contains(":completed:"),
                "stepCompleted status 应为 completed: " + events);

        // 5. finished 必须是最后一个，且 status=completed
        assertEquals("finished:completed", events.get(events.size() - 1),
                "最后事件应为 finished:completed, 实际: " + events);
    }

    @Test
    void setProgressListener_null时回退到NOOP不抛异常() {
        StubGLMClient llm = new StubGLMClient(List.of(
                response("""
                        {
                          "summary": "单步",
                          "steps": [{"id": "s1", "description": "任务", "type": "COMMAND", "dependencies": []}]
                        }
                        """),
                response("结果"),
                response("{\"approved\": true, \"summary\": \"ok\", \"issues\": []}")
        ));
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm, new ToolRegistry(), new NoOpMemoryManager(tempDir.toFile()));
        // null 不应抛异常
        assertDoesNotThrow(() -> orchestrator.setProgressListener(null));
        assertDoesNotThrow(() -> orchestrator.run("null listener 测试"));
    }

    @Test
    void 前置步骤失败时后续步骤触发skipped回调() {
        // 第一步返回空内容 → FAILED → 第二步（依赖第一步）被跳过 → stepCompleted(skipped)
        StubGLMClient llm = new StubGLMClient(List.of(
                response("""
                        {
                          "summary": "两步任务",
                          "steps": [
                            {"id": "s1", "description": "第一步", "type": "COMMAND", "dependencies": []},
                            {"id": "s2", "description": "第二步", "type": "ANALYSIS", "dependencies": ["s1"]}
                          ]
                        }
                        """),
                response("") // worker 返回空 → 第一步失败
        ));

        CapturingListener listener = new CapturingListener();
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                llm, new ToolRegistry(), new NoOpMemoryManager(tempDir.toFile()));
        orchestrator.setProgressListener(listener);

        orchestrator.run("测试 skip 回调");

        List<String> events = listener.events;
        // 应有 stepCompleted:step_2:skipped:approved=false
        assertTrue(events.stream().anyMatch(e -> e.contains("step_2") && e.contains("skipped")),
                "跳过步骤应触发 skipped 回调: " + events);
        // finished 状态不应是 completed（有失败步骤）
        assertTrue(events.stream().anyMatch(e -> e.startsWith("finished:") && !e.contains("completed")),
                "有失败步骤时 finished 状态不应为 completed: " + events);
    }

    // ---- helpers ----

    private static int indexOfPrefix(List<String> list, String prefix) {
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).startsWith(prefix)) return i;
        }
        return -1;
    }

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
        public LlmClient.ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
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
