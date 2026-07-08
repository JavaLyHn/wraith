package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Planner;
import com.lyhn.wraith.plan.Task;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlanProgressWiringTest {

    @Test
    void 单步计划触发_planCreated_stepStarted_stepCompleted_planFinished() {
        List<String> events = new ArrayList<>();
        PlanProgressListener listener = new PlanProgressListener() {
            @Override public void planCreated(ExecutionPlan plan) { events.add("created:" + plan.getGoal()); }
            @Override public void stepStarted(String stepId) { events.add("started:" + stepId); }
            @Override public void stepCompleted(String stepId, boolean ok, String result) { events.add("completed:" + stepId + ":" + ok); }
            @Override public void planFinished(String finalResult) { events.add("finished"); }
        };

        // 用与 PlanExecuteAgentTest 相同的最小 stub:单步计划 + 直接返回内容的 LlmClient。
        FakeLlmClient llm = new FakeLlmClient("done");
        PlanExecuteAgent agent = new PlanExecuteAgent(
                llm, new ToolRegistry(), new SingleStepPlanner(llm), null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                listener
        );

        agent.run("做一件事");

        assertTrue(events.get(0).startsWith("created:"), events.toString());
        assertTrue(events.stream().anyMatch(e -> e.startsWith("started:")), events.toString());
        assertTrue(events.stream().anyMatch(e -> e.startsWith("completed:") && e.endsWith(":true")), events.toString());
        assertEquals("finished", events.get(events.size() - 1), events.toString());
    }

    /** 单步计划 stub：始终返回含 1 个 Task 的 ExecutionPlan。 */
    private static final class SingleStepPlanner extends Planner {
        private SingleStepPlanner(LlmClient llmClient) {
            super(llmClient);
        }

        @Override
        public ExecutionPlan createPlan(String goal) {
            ExecutionPlan plan = new ExecutionPlan("plan-wiring-test", goal);
            plan.addTask(new Task("task_1", "做一件事", Task.TaskType.FILE_READ));
            plan.computeExecutionOrder();
            return plan;
        }
    }

    /** 直接返回固定内容的 LlmClient stub，supportsTools() = false 避免工具调用分支。 */
    private static final class FakeLlmClient implements LlmClient {
        private final String content;

        private FakeLlmClient(String content) {
            this.content = content;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            return new ChatResponse("assistant", content, null, 10, 5);
        }

        @Override
        public String getModelName() { return "fake-model"; }

        @Override
        public String getProviderName() { return "fake"; }

        @Override
        public boolean supportsTools() { return false; }
    }
}
