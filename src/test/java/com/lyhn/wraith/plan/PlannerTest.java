package com.lyhn.wraith.plan;

import com.lyhn.wraith.llm.GLMClient;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlannerTest {

    @Test
    void createsMinimalPlanForSimpleGoalWithoutCallingLlm() throws Exception {
        Planner planner = new Planner(new FailingGLMClient());

        ExecutionPlan plan = planner.createPlan("列出当前目录的文件");

        assertEquals("直接执行简单任务：列出当前目录的文件", plan.getSummary());
        assertEquals(List.of("task_1"), plan.getExecutionOrder());
        Task task = plan.getTask("task_1");
        assertEquals(Task.TaskType.COMMAND, task.getType());
        assertEquals("列出当前目录的文件", task.getDescription());
    }

    @Test
    void delegatesComplexGoalToLlmPlannerPath() throws Exception {
        StubGLMClient client = new StubGLMClient("""
                {
                  "summary": "复杂任务",
                  "tasks": [
                    {
                      "id": "task_a",
                      "description": "先读取 pom.xml",
                      "type": "FILE_READ",
                      "dependencies": []
                    },
                    {
                      "id": "task_b",
                      "description": "再验证项目结构",
                      "type": "VERIFICATION",
                      "dependencies": ["task_a"]
                    }
                  ]
                }
                """);
        Planner planner = new Planner(client);
        planner.setProjectMemorySupplier(() -> "## WRAITH.md 项目记忆\n- 计划前必须读取项目规则");

        ExecutionPlan plan = planner.createPlan("先读取 pom.xml 然后验证项目结构");

        assertEquals("复杂任务", plan.getSummary());
        assertEquals(2, plan.getAllTasks().size());
        assertTrue(plan.getTask("task_2").getDependencies().contains("task_1"));
        assertTrue(client.lastSystemPrompt.contains("计划前必须读取项目规则"));
    }

    private static final class FailingGLMClient extends GLMClient {
        private FailingGLMClient() {
            super("test-key");
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            throw new IOException("simple goal should not call llm");
        }
    }

    private static final class StubGLMClient extends GLMClient {
        private final String content;
        private String lastSystemPrompt = "";

        private StubGLMClient(String content) {
            super("test-key");
            this.content = content;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            this.lastSystemPrompt = messages.get(0).content();
            return new ChatResponse("assistant", content, null, 100, 20);
        }
    }

    // ── createPlan(goal, extra) 每调用可选 StreamListener（桌面规划器流式）─────────

    @Test
    void createPlanForwardsGenerationDeltasToExtraListener() throws Exception {
        StreamingStubClient client = new StreamingStubClient(
                "规划中：先读后验…",
                "{\"summary\":\"复杂\",\"tasks\":[{\"id\":\"t1\",\"description\":\"先读取 pom.xml\",\"type\":\"FILE_READ\",\"dependencies\":[]}]}");
        Planner planner = new Planner(client);
        List<String> captured = new ArrayList<>();
        LlmClient.StreamListener extra = new LlmClient.StreamListener() {
            @Override public void onContentDelta(String d) { captured.add(d); }
        };

        ExecutionPlan plan = planner.createPlan("先读取 pom.xml 然后验证项目结构", extra);

        assertEquals("复杂", plan.getSummary());
        assertTrue(captured.stream().anyMatch(s -> s.contains("规划中")),
                "extra listener should receive plan-generation deltas; got=" + captured);
    }

    @Test
    void createPlanWithoutExtraStillGeneratesPlan() throws Exception {
        StreamingStubClient client = new StreamingStubClient(
                "x",
                "{\"summary\":\"复杂\",\"tasks\":[{\"id\":\"t1\",\"description\":\"先读取\",\"type\":\"FILE_READ\",\"dependencies\":[]}]}");
        Planner planner = new Planner(client);

        ExecutionPlan plan = planner.createPlan("先读取 pom.xml 然后验证项目结构"); // 无 extra，CLI 路径

        assertEquals("复杂", plan.getSummary());
        assertFalse(plan.getAllTasks().isEmpty());
    }

    /** 流式桩：chat 时先对 listener 吐一段 delta，再返回计划 JSON。 */
    private static final class StreamingStubClient extends GLMClient {
        private final String delta;
        private final String content;

        private StreamingStubClient(String delta, String content) {
            super("test-key");
            this.delta = delta;
            this.content = content;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (listener != null && delta != null && !delta.isEmpty()) {
                listener.onContentDelta(delta);
            }
            return new ChatResponse("assistant", content, null, 100, 20);
        }
    }
}
