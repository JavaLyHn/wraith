package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task A4：计划复审通道单元测试。
 * 验证 requestPlanReview 阻塞/响应语义，以及 plan.* 通知的方法名与 payload 键。
 */
class PlanReviewChannelTest {

    /** 辅助：从 ByteArrayOutputStream 中解析所有 JSON-RPC 行，返回第一条 method 匹配的 params 节点。 */
    private static JsonNode findNotification(ByteArrayOutputStream out, String method) throws Exception {
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (ln.isBlank()) continue;
            JsonNode n = JsonRpc.MAPPER.readTree(ln);
            if (method.equals(n.path("method").asText())) {
                return n.get("params");
            }
        }
        return null;
    }

    // ---- 1. 阻塞/响应主流程 ----

    @Test
    void requestPlanReview_blocksUntilResolved() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-plan-1");
        renderer.setCurrentTurnId("turn-1");

        List<Map<String, Object>> steps = List.of(
                Map.of("id", "s1", "description", "分析需求"),
                Map.of("id", "s2", "description", "生成代码")
        );

        // 在独立线程中调用阻塞方法
        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<EventStreamRenderer.PlanReviewOutcome> fut =
                ex.submit(() -> renderer.requestPlanReview("plan_1", "实现功能 X", steps));

        // 主线程轮询直到 plan.review.requested 通知出现，取出 reviewId
        String reviewId = null;
        for (int i = 0; i < 100 && reviewId == null; i++) {
            JsonNode params = findNotification(out, "plan.review.requested");
            if (params != null) {
                reviewId = params.path("reviewId").asText(null);
            }
            if (reviewId == null) Thread.sleep(20);
        }

        assertNotNull(reviewId, "应发出 plan.review.requested 并携带 reviewId");
        assertFalse(fut.isDone(), "未响应前 requestPlanReview 应阻塞");

        // 响应复审
        renderer.resolvePlanReview(reviewId, "supplement", "再加一步");

        EventStreamRenderer.PlanReviewOutcome outcome = fut.get(2, TimeUnit.SECONDS);
        assertEquals("supplement", outcome.decision());
        assertEquals("再加一步", outcome.feedback());
        ex.shutdownNow();
    }

    @Test
    void requestPlanReview_notificationCarriesPlanIdGoalSteps() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-plan-2");
        renderer.setCurrentTurnId("turn-1");

        List<Map<String, Object>> steps = List.of(Map.of("id", "s1", "description", "步骤一"));
        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<EventStreamRenderer.PlanReviewOutcome> fut =
                ex.submit(() -> renderer.requestPlanReview("plan_2", "目标 Y", steps));

        // 等通知出现并解析 payload
        JsonNode params = null;
        for (int i = 0; i < 100 && params == null; i++) {
            params = findNotification(out, "plan.review.requested");
            if (params == null) Thread.sleep(20);
        }
        assertNotNull(params);
        assertEquals("plan_2", params.path("planId").asText());
        assertEquals("目标 Y", params.path("goal").asText());
        assertTrue(params.has("steps"), "payload 应包含 steps 字段");
        assertTrue(params.get("steps").isArray());

        // 解除阻塞（cancel）
        renderer.resolvePlanReview(params.path("reviewId").asText(), "cancel", null);
        fut.get(2, TimeUnit.SECONDS);
        ex.shutdownNow();
    }

    @Test
    void resolvePlanReview_unknownIdIsNoop() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-plan-3");
        // 未知 reviewId 不应抛出
        assertDoesNotThrow(() -> renderer.resolvePlanReview("review_nonexistent", "execute", null));
    }

    // ---- 2. plan.* 通知方法名与 payload 键 ----

    @Test
    void emitPlanCreated_notificationMethodAndPayload() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-emit-1");
        renderer.setCurrentTurnId("turn-emit");

        List<Map<String, Object>> steps = List.of(Map.of("id", "s1", "description", "初始化"));
        renderer.emitPlanCreated("plan_c1", "创建目标", steps);

        JsonNode params = findNotification(out, "plan.created");
        assertNotNull(params, "应发出 plan.created 通知");
        assertEquals("plan_c1", params.path("planId").asText());
        assertEquals("创建目标", params.path("goal").asText());
        assertTrue(params.has("steps"), "应携带 steps 字段");
    }

    @Test
    void emitPlanStepStarted_notificationMethodAndPayload() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-emit-2");
        renderer.setCurrentTurnId("turn-emit");

        renderer.emitPlanStepStarted("plan_s1", "step_1");

        JsonNode params = findNotification(out, "plan.step.started");
        assertNotNull(params, "应发出 plan.step.started 通知");
        assertEquals("plan_s1", params.path("planId").asText());
        assertEquals("step_1", params.path("stepId").asText());
    }

    @Test
    void emitPlanStepCompleted_notificationMethodAndPayload() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-emit-3");
        renderer.setCurrentTurnId("turn-emit");

        renderer.emitPlanStepCompleted("plan_sc1", "step_2", true, "生成了 3 个文件");

        JsonNode params = findNotification(out, "plan.step.completed");
        assertNotNull(params, "应发出 plan.step.completed 通知");
        assertEquals("plan_sc1", params.path("planId").asText());
        assertEquals("step_2", params.path("stepId").asText());
        assertTrue(params.path("ok").asBoolean(), "ok 应为 true");
        assertEquals("生成了 3 个文件", params.path("result").asText());
    }

    @Test
    void emitPlanStepCompleted_failureFlag() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        EventStreamRenderer renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-emit-4");
        renderer.setCurrentTurnId("turn-emit");

        renderer.emitPlanStepCompleted("plan_sc2", "step_3", false, "执行出错");

        JsonNode params = findNotification(out, "plan.step.completed");
        assertNotNull(params);
        assertFalse(params.path("ok").asBoolean(), "ok 应为 false");
        assertEquals("执行出错", params.path("result").asText());
    }
}
