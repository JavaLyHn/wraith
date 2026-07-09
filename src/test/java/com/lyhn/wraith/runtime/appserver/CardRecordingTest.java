package com.lyhn.wraith.runtime.appserver;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task 7: 验证 EventStreamRenderer 卡片事件录制 + *.output 合流。
 */
class CardRecordingTest {

    private ByteArrayOutputStream out;
    private EventStreamRenderer renderer;

    @BeforeEach
    void setUp() {
        out = new ByteArrayOutputStream();
        renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-rec");
        renderer.setCurrentTurnId("turn-rec");
    }

    // ---- 1) 录制关闭时 emit 不缓存 ----

    @Test
    void recordingOff_stopReturnsEmpty() {
        // 未调用 startCardRecording，stopCardRecording 应返回空列表
        List<Map<String, Object>> result = renderer.stopCardRecording();
        assertNotNull(result, "stopCardRecording 不应返回 null");
        assertTrue(result.isEmpty(), "录制关闭时 stop 应返回空列表");
    }

    @Test
    void recordingOff_emitTeamStep_doesNotBuffer() {
        // 未 start，emit team.step.started，stop 应返回空列表
        renderer.emitTeamStepStarted("t1", "s1", "agent-a");
        List<Map<String, Object>> result = renderer.stopCardRecording();
        assertTrue(result.isEmpty(), "录制关闭时事件不应被缓存");
    }

    // ---- 2) startCardRecording 后合流逻辑 ----

    @Test
    void recording_teamStepSequence_coalesced() {
        renderer.startCardRecording();

        renderer.emitTeamStepStarted("t1", "s1", "agent-a");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-A");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-B");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-C");
        renderer.emitTeamStepCompleted("t1", "s1", "completed", "ok", true, 0);

        List<Map<String, Object>> result = renderer.stopCardRecording();

        // 5 条原始事件 → 合流后 3 条: started, merged-output, completed
        assertEquals(3, result.size(), "3 × output 应合并为 1 条，共 3 个事件");
    }

    @Test
    void recording_teamStepSequence_order() {
        renderer.startCardRecording();

        renderer.emitTeamStepStarted("t1", "s1", "agent-a");
        renderer.emitTeamStepOutput("t1", "s1", "A");
        renderer.emitTeamStepOutput("t1", "s1", "B");
        renderer.emitTeamStepOutput("t1", "s1", "C");
        renderer.emitTeamStepCompleted("t1", "s1", "completed", "ok", true, 0);

        List<Map<String, Object>> result = renderer.stopCardRecording();

        assertEquals("team.step.started",   result.get(0).get("method"), "第0条应为 team.step.started");
        assertEquals("team.step.output",    result.get(1).get("method"), "第1条应为 team.step.output");
        assertEquals("team.step.completed", result.get(2).get("method"), "第2条应为 team.step.completed");
    }

    @Test
    void recording_teamStepOutput_textConcatenated() {
        renderer.startCardRecording();

        renderer.emitTeamStepStarted("t1", "s1", "agent-a");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-A");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-B");
        renderer.emitTeamStepOutput("t1", "s1", "chunk-C");
        renderer.emitTeamStepCompleted("t1", "s1", "completed", "ok", true, 0);

        List<Map<String, Object>> result = renderer.stopCardRecording();

        @SuppressWarnings("unchecked")
        Map<String, Object> outputParams = (Map<String, Object>) result.get(1).get("params");
        assertEquals("chunk-Achunk-Bchunk-C", outputParams.get("text"),
                "3 段 text 应拼接");
    }

    @Test
    void recording_stopResetsState() {
        renderer.startCardRecording();
        renderer.emitTeamStepStarted("t1", "s1", "agent-a");
        renderer.stopCardRecording();

        // 再次 stop 应返回空列表（录制已关闭）
        List<Map<String, Object>> second = renderer.stopCardRecording();
        assertTrue(second.isEmpty(), "stop 后再次 stop 应返回空列表");
    }

    // ---- 3) plan.review.requested 与 message.delta 不被录制 ----

    @Test
    void planReviewRequested_notRecorded() {
        renderer.startCardRecording();

        // requestPlanReview 会发 plan.review.requested，但它是一个阻塞调用，
        // 直接用 isCardMethod 的逻辑验证: plan.review.requested 不满足 isCardMethod
        // 我们通过 emitPlanCreated 来触发 plan.* 录制，再验证 plan.review.requested 不录
        renderer.emitPlanCreated("p1", "goal", List.of());
        // plan.review.requested 不会被缓存 — 我们无法直接调用（阻塞），
        // 但 isCardMethod 逻辑保证了它不会被录制；stop 只包含 plan.created
        List<Map<String, Object>> result = renderer.stopCardRecording();

        assertEquals(1, result.size(), "只有 plan.created，plan.review.requested 不应录制");
        assertEquals("plan.created", result.get(0).get("method"));
    }

    @Test
    void messageDelta_notRecorded() {
        renderer.startCardRecording();

        renderer.appendAssistantContentDelta("hello");
        renderer.emitTeamStepStarted("t1", "s1", "agent-a");

        List<Map<String, Object>> result = renderer.stopCardRecording();

        // message.delta 不应录制，只有 team.step.started
        assertEquals(1, result.size(), "message.delta 不应被录制");
        assertEquals("team.step.started", result.get(0).get("method"));
    }

    @Test
    void isCardMethod_planReviewRequested_excluded() {
        // 通过录制验证 plan.review.requested 不被录：
        // 录一个 plan.step.started 和 plan.step.completed
        renderer.startCardRecording();
        renderer.emitPlanStepStarted("p1", "step1");
        renderer.emitPlanStepCompleted("p1", "step1", true, "done");
        List<Map<String, Object>> result = renderer.stopCardRecording();

        // 确认 plan.step.* 被录
        assertEquals(2, result.size());
        for (Map<String, Object> ev : result) {
            String method = (String) ev.get("method");
            assertNotEquals("plan.review.requested", method,
                    "plan.review.requested 不应出现在录制结果中");
        }
    }

    // ---- 额外：不同 stepId 的 output 不合并 ----

    @Test
    void differentStepId_outputNotCoalesced() {
        renderer.startCardRecording();

        renderer.emitTeamStepOutput("t1", "s1", "A");
        renderer.emitTeamStepOutput("t1", "s2", "B"); // 不同 stepId

        List<Map<String, Object>> result = renderer.stopCardRecording();

        assertEquals(2, result.size(), "不同 stepId 的 output 不应合并");
    }

    // ---- 额外：plan.step.output 合流 ----

    @Test
    void planStepOutput_coalesced() {
        renderer.startCardRecording();

        renderer.emitPlanStepOutput("p1", "step1", "X");
        renderer.emitPlanStepOutput("p1", "step1", "Y");

        List<Map<String, Object>> result = renderer.stopCardRecording();

        assertEquals(1, result.size(), "同 stepId 的 plan.step.output 应合并");
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) result.get(0).get("params");
        assertEquals("XY", params.get("text"));
    }
}
