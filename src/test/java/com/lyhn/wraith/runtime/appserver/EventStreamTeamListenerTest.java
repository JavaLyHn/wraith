package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.agent.TeamProgressListener;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task 2：验证 EventStreamTeamListener 将 Team 生命周期正确翻译成 team.* JSON-RPC 通知。
 */
class EventStreamTeamListenerTest {

    private ByteArrayOutputStream out;
    private EventStreamRenderer renderer;
    private EventStreamTeamListener listener;

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

    @BeforeEach
    void setUp() {
        out = new ByteArrayOutputStream();
        renderer = new EventStreamRenderer(new JsonRpcWriter(out), "sess-t2");
        renderer.setCurrentTurnId("turn-t2");
        listener = new EventStreamTeamListener(renderer, "team_1");
    }

    // ---- started ----

    @Test
    void started_emitsTeamStartedNotification() throws Exception {
        List<TeamProgressListener.AgentInfo> agents = List.of(
                new TeamProgressListener.AgentInfo("a1", "researcher"),
                new TeamProgressListener.AgentInfo("a2", "coder"));
        listener.started("test goal", agents);

        JsonNode params = findNotification("team.started");
        assertNotNull(params, "started 应发出 team.started 通知");
        assertEquals("team_1", params.path("teamId").asText());
        assertEquals("test goal", params.path("goal").asText());
    }

    @Test
    void started_agentsListHasCorrectSize() throws Exception {
        List<TeamProgressListener.AgentInfo> agents = List.of(
                new TeamProgressListener.AgentInfo("a1", "researcher"),
                new TeamProgressListener.AgentInfo("a2", "coder"));
        listener.started("test goal", agents);

        JsonNode params = findNotification("team.started");
        assertNotNull(params);
        JsonNode agentsNode = params.get("agents");
        assertNotNull(agentsNode, "team.started 应包含 agents 字段");
        assertTrue(agentsNode.isArray(), "agents 应为数组");
        assertEquals(2, agentsNode.size(), "2 个 agent 应对应 agents 长度 2");
    }

    @Test
    void started_eachAgentHasIdAndRole() throws Exception {
        List<TeamProgressListener.AgentInfo> agents = List.of(
                new TeamProgressListener.AgentInfo("a1", "researcher"));
        listener.started("goal", agents);

        JsonNode params = findNotification("team.started");
        assertNotNull(params);
        JsonNode agentNode = params.get("agents").get(0);
        assertEquals("a1", agentNode.path("id").asText());
        assertEquals("researcher", agentNode.path("role").asText());
    }

    // ---- planParsed ----

    @Test
    void planParsed_emitsTeamPlanNotification() throws Exception {
        List<TeamProgressListener.StepInfo> steps = List.of(
                new TeamProgressListener.StepInfo("s1", "分析需求", "ANALYSIS", null),
                new TeamProgressListener.StepInfo("s2", "编写代码", "COMMAND", List.of("s1")));
        listener.planParsed(steps);

        JsonNode params = findNotification("team.plan");
        assertNotNull(params, "planParsed 应发出 team.plan 通知");
        assertEquals("team_1", params.path("teamId").asText());
    }

    @Test
    void planParsed_stepsLengthAndKeys() throws Exception {
        List<TeamProgressListener.StepInfo> steps = List.of(
                new TeamProgressListener.StepInfo("s1", "描述1", "ANALYSIS", null));
        listener.planParsed(steps);

        JsonNode params = findNotification("team.plan");
        assertNotNull(params);
        JsonNode stepsNode = params.get("steps");
        assertNotNull(stepsNode, "team.plan 应包含 steps 字段");
        assertTrue(stepsNode.isArray());
        assertEquals(1, stepsNode.size());
        JsonNode s = stepsNode.get(0);
        assertTrue(s.has("id"));
        assertTrue(s.has("description"));
        assertTrue(s.has("type"));
        assertTrue(s.has("dependencies"));
    }

    @Test
    void planParsed_nullDependenciesBecomesEmptyList() throws Exception {
        List<TeamProgressListener.StepInfo> steps = List.of(
                new TeamProgressListener.StepInfo("s1", "步骤", "ANALYSIS", null));
        listener.planParsed(steps);

        JsonNode params = findNotification("team.plan");
        assertNotNull(params);
        JsonNode deps = params.get("steps").get(0).get("dependencies");
        assertNotNull(deps);
        assertTrue(deps.isArray(), "null dependencies 应序列化为空数组");
        assertEquals(0, deps.size());
    }

    // ---- batchStarted ----

    @Test
    void batchStarted_emitsTeamBatchNotification() throws Exception {
        listener.batchStarted(0, List.of("s1", "s2"));

        JsonNode params = findNotification("team.batch");
        assertNotNull(params, "batchStarted 应发出 team.batch 通知");
        assertEquals("team_1", params.path("teamId").asText());
        assertEquals(0, params.path("batchIndex").asInt());
    }

    @Test
    void batchStarted_stepIdsInPayload() throws Exception {
        listener.batchStarted(1, List.of("s3", "s4"));

        JsonNode params = findNotification("team.batch");
        assertNotNull(params);
        JsonNode stepIds = params.get("stepIds");
        assertNotNull(stepIds, "team.batch 应包含 stepIds 字段");
        assertTrue(stepIds.isArray());
        assertEquals(2, stepIds.size());
        assertEquals("s3", stepIds.get(0).asText());
        assertEquals("s4", stepIds.get(1).asText());
    }

    // ---- stepStarted ----

    @Test
    void stepStarted_emitsTeamStepStartedNotification() throws Exception {
        listener.stepStarted("s1", "agent-alpha");

        JsonNode params = findNotification("team.step.started");
        assertNotNull(params, "stepStarted 应发出 team.step.started 通知");
        assertEquals("team_1", params.path("teamId").asText());
        assertEquals("s1", params.path("stepId").asText());
        assertEquals("agent-alpha", params.path("agent").asText());
    }

    // ---- stepCompleted ----

    @Test
    void stepCompleted_completed_emitsTeamStepCompleted() throws Exception {
        listener.stepCompleted("s1", "completed", "成功结果", true, 0);

        JsonNode params = findNotification("team.step.completed");
        assertNotNull(params, "stepCompleted 应发出 team.step.completed 通知");
        assertEquals("team_1", params.path("teamId").asText());
        assertEquals("s1", params.path("stepId").asText());
        assertEquals("completed", params.path("status").asText());
        assertEquals("成功结果", params.path("result").asText());
        assertTrue(params.path("approved").asBoolean());
        assertEquals(0, params.path("retries").asInt());
    }

    @Test
    void stepCompleted_failed_emitsCorrectStatus() throws Exception {
        listener.stepCompleted("s2", "failed", "执行失败", false, 2);

        JsonNode params = findNotification("team.step.completed");
        assertNotNull(params);
        assertEquals("failed", params.path("status").asText());
        assertFalse(params.path("approved").asBoolean());
        assertEquals(2, params.path("retries").asInt());
    }

    @Test
    void stepCompleted_nullResult_serializedAsEmpty() throws Exception {
        listener.stepCompleted("s1", "skipped", null, false, 0);

        JsonNode params = findNotification("team.step.completed");
        assertNotNull(params);
        assertEquals("", params.path("result").asText(), "null result 应序列化为空字符串");
    }

    // ---- finished ----

    @Test
    void finished_emitsTeamFinishedNotification() throws Exception {
        listener.finished("completed");

        JsonNode params = findNotification("team.finished");
        assertNotNull(params, "finished 应发出 team.finished 通知");
        assertEquals("team_1", params.path("teamId").asText());
        assertEquals("completed", params.path("status").asText());
    }

    @Test
    void finished_partialStatus() throws Exception {
        listener.finished("partial");

        JsonNode params = findNotification("team.finished");
        assertNotNull(params);
        assertEquals("partial", params.path("status").asText());
    }

    // ---- session/turn fields propagated ----

    @Test
    void allNotifications_containSessionIdAndTurnId() throws Exception {
        listener.started("goal", List.of());

        JsonNode params = findNotification("team.started");
        assertNotNull(params);
        assertEquals("sess-t2", params.path("sessionId").asText(), "sessionId 应在 params 中");
        assertEquals("turn-t2", params.path("turnId").asText(), "turnId 应在 params 中");
    }
}
