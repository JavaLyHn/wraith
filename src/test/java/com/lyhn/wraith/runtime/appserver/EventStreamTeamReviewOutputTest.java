package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task 2: 验证 EventStreamRenderer.emitTeamReviewOutput 和
 * EventStreamTeamStreamListener review 路由。
 */
class EventStreamTeamReviewOutputTest {

    private ByteArrayOutputStream out;
    private EventStreamRenderer renderer;

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

    @BeforeEach
    void setUp() {
        out = new ByteArrayOutputStream();
        renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-review");
        renderer.setCurrentTurnId("turn-review");
    }

    // ---- emitTeamReviewOutput 直接调用 ----

    @Test
    void emitTeamReviewOutput_method() throws Exception {
        renderer.emitTeamReviewOutput("t1", "step_1", "审查片段");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params, "emitTeamReviewOutput 应发出 team.review.output 通知");
    }

    @Test
    void emitTeamReviewOutput_teamId() throws Exception {
        renderer.emitTeamReviewOutput("t1", "step_1", "审查片段");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("t1", params.path("teamId").asText());
    }

    @Test
    void emitTeamReviewOutput_stepId() throws Exception {
        renderer.emitTeamReviewOutput("t1", "step_1", "审查片段");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("step_1", params.path("stepId").asText());
    }

    @Test
    void emitTeamReviewOutput_text() throws Exception {
        renderer.emitTeamReviewOutput("t1", "step_1", "审查片段");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("审查片段", params.path("text").asText());
    }

    @Test
    void emitTeamReviewOutput_containsSessionIdAndTurnId() throws Exception {
        renderer.emitTeamReviewOutput("t1", "step_1", "delta");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("sess-review", params.path("sessionId").asText());
        assertEquals("turn-review", params.path("turnId").asText());
    }

    // ---- EventStreamTeamStreamListener review 路由 ----

    @Test
    void reviewKind_emitsTeamReviewOutput() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "t1", "review", "step_1");
        listener.onContentDelta("x");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params, "review kind 应发出 team.review.output 通知");
        assertEquals("step_1", params.path("stepId").asText());
    }

    @Test
    void reviewKind_textPropagated() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "t1", "review", "step_1");
        listener.onContentDelta("审查片段");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("审查片段", params.path("text").asText());
    }

    @Test
    void reviewKind_teamIdPropagated() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "team_99", "review", "step_2");
        listener.onContentDelta("delta");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params);
        assertEquals("team_99", params.path("teamId").asText());
    }

    @Test
    void reviewKind_doesNotEmitStepOutput() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "t1", "review", "step_1");
        listener.onContentDelta("delta");

        assertNull(findNotification("team.step.output"),
                "review kind 不应发出 team.step.output 通知");
    }

    @Test
    void reviewKind_doesNotEmitPlanOutput() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "t1", "review", "step_1");
        listener.onContentDelta("delta");

        assertNull(findNotification("team.plan.output"),
                "review kind 不应发出 team.plan.output 通知");
    }

    @Test
    void reviewKind_reasoningDeltaRoutedToReviewOutput() throws Exception {
        EventStreamTeamStreamListener listener =
                new EventStreamTeamStreamListener(renderer, "t1", "review", "step_1");
        listener.onReasoningDelta("reasoning delta");

        JsonNode params = findNotification("team.review.output");
        assertNotNull(params, "review kind reasoning delta 应路由到 team.review.output");
        assertEquals("reasoning delta", params.path("text").asText());
    }
}
