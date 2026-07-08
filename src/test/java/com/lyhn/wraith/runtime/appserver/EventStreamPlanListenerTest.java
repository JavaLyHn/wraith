package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Task;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task A5：验证 EventStreamPlanListener 将 Plan 生命周期正确翻译成 plan.* JSON-RPC 通知。
 */
class EventStreamPlanListenerTest {

    private ByteArrayOutputStream out;
    private EventStreamRenderer renderer;
    private EventStreamPlanListener listener;

    /** 从捕获输出中找第一条 method 匹配的 params 节点。 */
    private JsonNode findNotification(String method) throws Exception {
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (ln.isBlank()) continue;
            JsonNode n = JsonRpc.MAPPER.readTree(ln);
            if (method.equals(n.path("method").asText())) {
                return n.get("params");
            }
        }
        return null;
    }

    /** 构造含 2 个 Task 的 ExecutionPlan：t1 无依赖，t2 依赖 t1。 */
    private ExecutionPlan buildPlan() {
        ExecutionPlan plan = new ExecutionPlan("plan_1", "测试目标");
        Task t1 = new Task("t1", "第一步描述", Task.TaskType.ANALYSIS);
        Task t2 = new Task("t2", "第二步描述", Task.TaskType.COMMAND, List.of("t1"));
        plan.addTask(t1);
        plan.addTask(t2);
        plan.computeExecutionOrder();
        return plan;
    }

    @BeforeEach
    void setUp() {
        out = new ByteArrayOutputStream();
        renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-a5");
        renderer.setCurrentTurnId("turn-a5");
        listener = new EventStreamPlanListener(renderer, "plan_1");
    }

    // ---- planCreated ----

    @Test
    void planCreated_emitsPlanCreatedNotification() throws Exception {
        listener.planCreated(buildPlan());

        JsonNode params = findNotification("plan.created");
        assertNotNull(params, "planCreated 应发出 plan.created 通知");
        assertEquals("plan_1", params.path("planId").asText());
        assertEquals("测试目标", params.path("goal").asText());
    }

    @Test
    void planCreated_stepsLengthIs2() throws Exception {
        listener.planCreated(buildPlan());

        JsonNode params = findNotification("plan.created");
        assertNotNull(params);
        JsonNode steps = params.get("steps");
        assertNotNull(steps, "plan.created 应包含 steps 字段");
        assertTrue(steps.isArray(), "steps 应为数组");
        assertEquals(2, steps.size(), "2 个任务应对应 steps 长度 2");
    }

    @Test
    void planCreated_eachStepHasRequiredKeys() throws Exception {
        listener.planCreated(buildPlan());

        JsonNode params = findNotification("plan.created");
        assertNotNull(params);
        for (JsonNode step : params.get("steps")) {
            assertTrue(step.has("id"), "每个 step 应有 id 键");
            assertTrue(step.has("description"), "每个 step 应有 description 键");
            assertTrue(step.has("deps"), "每个 step 应有 deps 键");
        }
    }

    // ---- stepStarted ----

    @Test
    void stepStarted_emitsPlanStepStartedWithStepId() throws Exception {
        listener.stepStarted("t1");

        JsonNode params = findNotification("plan.step.started");
        assertNotNull(params, "stepStarted 应发出 plan.step.started 通知");
        assertEquals("plan_1", params.path("planId").asText());
        assertEquals("t1", params.path("stepId").asText());
    }

    // ---- stepCompleted ----

    @Test
    void stepCompleted_success_emitsOkTrueAndResult() throws Exception {
        listener.stepCompleted("t1", true, "ok");

        JsonNode params = findNotification("plan.step.completed");
        assertNotNull(params, "stepCompleted 应发出 plan.step.completed 通知");
        assertEquals("plan_1", params.path("planId").asText());
        assertEquals("t1", params.path("stepId").asText());
        assertTrue(params.path("ok").asBoolean(), "ok 应为 true");
        assertEquals("ok", params.path("result").asText());
    }

    @Test
    void stepCompleted_failure_emitsOkFalse() throws Exception {
        listener.stepCompleted("t2", false, "执行失败");

        JsonNode params = findNotification("plan.step.completed");
        assertNotNull(params);
        assertFalse(params.path("ok").asBoolean(), "ok 应为 false");
        assertEquals("执行失败", params.path("result").asText());
    }

    // ---- planFinished ----

    @Test
    void planFinished_emitsMessageEnd() throws Exception {
        listener.planFinished("计划完成");

        JsonNode params = findNotification("message.end");
        assertNotNull(params, "planFinished 应发出 message.end 通知");
    }

    // ---- EventStreamStepListener（optional light test）----

    @Test
    void stepListener_onContentDelta_emitsMessageDelta() throws Exception {
        EventStreamStepListener stepListener = new EventStreamStepListener(renderer);
        stepListener.onContentDelta("hello");

        JsonNode params = findNotification("message.delta");
        assertNotNull(params, "onContentDelta 应发出 message.delta 通知");
        assertEquals("hello", params.path("text").asText());
    }

    @Test
    void stepListener_onContentDelta_skipsNullOrEmpty() throws Exception {
        EventStreamStepListener stepListener = new EventStreamStepListener(renderer);
        stepListener.onContentDelta(null);
        stepListener.onContentDelta("");

        // 无 message.delta 通知
        assertNull(findNotification("message.delta"), "null/空 delta 不应发出通知");
    }

    @Test
    void stepListener_onReasoningDelta_emitsThinkingBeginThenDelta() throws Exception {
        EventStreamStepListener stepListener = new EventStreamStepListener(renderer);
        stepListener.onReasoningDelta("思考片段");

        JsonNode beginParams = findNotification("thinking.begin");
        assertNotNull(beginParams, "首个非空 reasoning delta 应触发 thinking.begin");
        assertEquals("计划步骤", beginParams.path("label").asText());

        JsonNode deltaParams = findNotification("thinking.delta");
        assertNotNull(deltaParams, "应发出 thinking.delta 通知");
        assertEquals("思考片段", deltaParams.path("text").asText());
    }

    @Test
    void stepListener_onReasoningDelta_skipsBlank() throws Exception {
        EventStreamStepListener stepListener = new EventStreamStepListener(renderer);
        stepListener.onReasoningDelta("   ");
        stepListener.onReasoningDelta(null);

        assertNull(findNotification("thinking.begin"), "空白 reasoning delta 不应触发 thinking.begin");
    }
}
