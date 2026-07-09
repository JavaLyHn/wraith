package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Planner;
import com.lyhn.wraith.plan.Task;
import com.lyhn.wraith.runtime.CancellationContext;
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

    @Test
    void LLM抛出异常时_stepCompleted记录false且planFinished恰好调用一次() {
        List<String> events = new ArrayList<>();
        PlanProgressListener listener = new PlanProgressListener() {
            @Override public void planCreated(ExecutionPlan plan) { events.add("created"); }
            @Override public void stepStarted(String stepId) { events.add("started:" + stepId); }
            @Override public void stepCompleted(String stepId, boolean ok, String result) { events.add("completed:" + stepId + ":" + ok); }
            @Override public void planFinished(String finalResult) { events.add("finished"); }
        };

        // LlmClient 直接抛异常，驱动失败路径；
        // FailingStepPlanner 覆写 replan 也抛异常，防止失败后无限重规划循环。
        LlmClient throwingLlm = new ThrowingLlmClient("simulated failure");
        PlanExecuteAgent agent = new PlanExecuteAgent(
                throwingLlm, new ToolRegistry(), new FailingStepPlanner(throwingLlm), null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                listener
        );

        agent.run("做一件事");

        // stepCompleted 含 false 条目
        assertTrue(events.stream().anyMatch(e -> e.startsWith("completed:") && e.endsWith(":false")),
                "期望至少一条 completed:...:false 事件: " + events);
        // planFinished 恰好调用一次
        long finishedCount = events.stream().filter("finished"::equals).count();
        assertEquals(1, finishedCount, "planFinished 应恰好调用一次: " + events);
    }

    @Test
    void 入口取消检查时_planFinished仍恰好调用一次() {
        List<String> events = new ArrayList<>();
        PlanProgressListener listener = new PlanProgressListener() {
            @Override public void planCreated(ExecutionPlan plan) { events.add("created"); }
            @Override public void stepStarted(String stepId) { events.add("started"); }
            @Override public void stepCompleted(String stepId, boolean ok, String result) { events.add("completed"); }
            @Override public void planFinished(String finalResult) { events.add("finished"); }
        };

        FakeLlmClient llm = new FakeLlmClient("done");
        PlanExecuteAgent agent = new PlanExecuteAgent(
                llm, new ToolRegistry(), new SingleStepPlanner(llm), null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                listener
        );

        // 设置取消标志，然后 run()
        com.lyhn.wraith.runtime.CancellationToken token = CancellationContext.startRun();
        token.cancel();
        try {
            agent.run("做一件事");
        } finally {
            CancellationContext.clear(token);
        }

        long finishedCount = events.stream().filter("finished"::equals).count();
        assertEquals(1, finishedCount, "入口取消时 planFinished 应恰好调用一次: " + events);
        // 取消路径不应触发 planCreated/stepStarted/stepCompleted
        assertFalse(events.contains("created"), "取消路径不应触发 planCreated: " + events);
    }

    @Test
    void 注入的步骤工厂接收正文流() {
        StringBuilder body = new StringBuilder();
        FakeLlmClient llm = new FakeLlmClient("hello-body");
        PlanExecuteAgent agent = new PlanExecuteAgent(
                llm, new ToolRegistry(), new SingleStepPlanner(llm), null,
                (goal, plan) -> PlanExecuteAgent.PlanReviewDecision.execute(),
                new java.io.PrintStream(java.io.OutputStream.nullOutputStream()),
                PlanProgressListener.NOOP);
        agent.setStepStreamFactory((id, ss) -> new LlmClient.StreamListener() {
            @Override public void onContentDelta(String delta) { body.append(delta); }
        });
        agent.run("做一件事");
        assertTrue(body.length() > 0, "自定义工厂应收到正文 delta");
    }

    /** 单步计划 stub：始终返回含 1 个 Task 的 ExecutionPlan。 */
    private static final class SingleStepPlanner extends Planner {
        private SingleStepPlanner(LlmClient llmClient) {
            super(llmClient);
        }

        @Override
        public ExecutionPlan createPlan(String goal, LlmClient.StreamListener extra) {
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
            // 向注入的 listener 推送 content delta，供步骤工厂测试拦截。
            if (listener != null && !content.isEmpty()) {
                listener.onContentDelta(content);
            }
            return new ChatResponse("assistant", content, null, 10, 5);
        }

        @Override
        public String getModelName() { return "fake-model"; }

        @Override
        public String getProviderName() { return "fake"; }

        @Override
        public boolean supportsTools() { return false; }
    }

    /**
     * 与 SingleStepPlanner 相同，但 replan() 抛 IOException，
     * 防止步骤失败后无限触发重规划循环。
     */
    private static final class FailingStepPlanner extends Planner {
        private FailingStepPlanner(LlmClient llmClient) {
            super(llmClient);
        }

        @Override
        public ExecutionPlan createPlan(String goal, LlmClient.StreamListener extra) {
            ExecutionPlan plan = new ExecutionPlan("plan-failure-test", goal);
            plan.addTask(new Task("task_1", "做一件事", Task.TaskType.FILE_READ));
            plan.computeExecutionOrder();
            return plan;
        }

        @Override
        public ExecutionPlan replan(ExecutionPlan failedPlan, String failureReason) throws IOException {
            throw new IOException("replan intentionally blocked in test: " + failureReason);
        }
    }

    /** chat() 直接抛 IOException，驱动步骤失败路径。 */
    private static final class ThrowingLlmClient implements LlmClient {
        private final String message;

        private ThrowingLlmClient(String message) {
            this.message = message;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            throw new IOException(this.message);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            throw new IOException(this.message);
        }

        @Override
        public String getModelName() { return "throwing-model"; }

        @Override
        public String getProviderName() { return "fake"; }

        @Override
        public boolean supportsTools() { return false; }
    }
}
