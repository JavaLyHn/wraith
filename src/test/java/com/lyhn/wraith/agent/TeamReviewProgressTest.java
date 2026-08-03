package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.GLMClient;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryManager;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * reviewer 的「开始 / 结束」回调。
 *
 * <p><b>症状</b>（用户实测）：团队卡上 reviewer 正在审查，界面上<b>一点动静都没有</b>，
 * 用户以为死机了。
 *
 * <p><b>根因</b>：reviewer 此前唯一的外部信号是流式正文增量
 * （{@code team.review.output}）。「reviewer 正在审查」这个阶段在事件流里<b>不存在</b>，
 * 前端于是无从知道 —— 审查块要等第一个 token 才出现，而思考型模型出第一个 token 前
 * 可能沉默几十秒；表头那个 reviewer 圆点跟的是「任意步骤在跑」，与 reviewer 无关。
 * CLI 侧一直有 {@code out.println("🔍 … 正在审查 …")} 这句叙述，桌面侧什么都没有。
 *
 * <p><b>这里守的不变量</b>：每个 {@code reviewStarted} 必须有配对的
 * {@code reviewCompleted} —— <b>包括 LLM 调用失败那条路</b>。漏一条，UI 就永远停在
 * 「审查中…」，那比现在的「没有指示」更糟：它会是一句持续的假话。
 */
class TeamReviewProgressTest {

    @TempDir
    Path tempDir;

    private static final class CapturingListener implements TeamProgressListener {
        final List<String> events = new ArrayList<>();
        @Override public void started(String goal, List<AgentInfo> agents) { events.add("started"); }
        @Override public void planParsed(List<StepInfo> steps) { events.add("planParsed:" + steps.size()); }
        @Override public void batchStarted(int i, List<String> ids) { events.add("batch"); }
        @Override public void stepStarted(String stepId, String agentName) { events.add("stepStarted:" + stepId); }
        @Override public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {
            events.add("stepCompleted:" + stepId + ":" + status);
        }
        @Override public void reviewStarted(String stepId) { events.add("reviewStarted:" + stepId); }
        @Override public void reviewCompleted(String stepId, boolean approved) {
            events.add("reviewCompleted:" + stepId + ":approved=" + approved);
        }
        @Override public void finished(String status) { events.add("finished:" + status); }
    }

    private static long count(List<String> events, String prefix) {
        return events.stream().filter(e -> e.startsWith(prefix)).count();
    }

    private static int indexOf(List<String> events, String prefix) {
        for (int i = 0; i < events.size(); i++) {
            if (events.get(i).startsWith(prefix)) return i;
        }
        return -1;
    }

    private static CapturingListener runWith(Path tempDir, List<LlmClient.ChatResponse> responses) {
        CapturingListener listener = new CapturingListener();
        AgentOrchestrator orchestrator = new AgentOrchestrator(
                new StubGLMClient(responses), new ToolRegistry(), new NoOpMemoryManager(tempDir.toFile()));
        orchestrator.setProgressListener(listener);
        orchestrator.run("测试 reviewer 进度回调");
        return listener;
    }

    private static final String ONE_STEP_PLAN = """
            {"summary":"单步","steps":[{"id":"s1","description":"执行分析","type":"ANALYSIS","dependencies":[]}]}
            """;

    @Test
    @DisplayName("审查通过:reviewStarted 在 review 之前、reviewCompleted(true) 在 stepCompleted 之前")
    void approvedPathBracketsTheReview() {
        List<String> e = runWith(tempDir, List.of(
                response(ONE_STEP_PLAN),
                response("分析结果内容"),
                response("{\"approved\": true, \"summary\": \"通过\", \"issues\": []}"))).events;

        int stepStarted = indexOf(e, "stepStarted:");
        int reviewStarted = indexOf(e, "reviewStarted:");
        int reviewCompleted = indexOf(e, "reviewCompleted:");
        int stepCompleted = indexOf(e, "stepCompleted:");

        assertTrue(reviewStarted > stepStarted, "reviewStarted 该在 stepStarted 之后: " + e);
        assertTrue(reviewCompleted > reviewStarted, "reviewCompleted 该在 reviewStarted 之后: " + e);
        assertTrue(stepCompleted > reviewCompleted,
                "stepCompleted 该在 reviewCompleted 之后 —— 步骤在审查期间仍是 running: " + e);
        assertTrue(e.get(reviewCompleted).contains("approved=true"), e.toString());
    }

    @Test
    @DisplayName("审查未通过后重试:每一轮审查各有一对 started/completed")
    void eachRetryRoundGetsItsOwnPair() {
        List<String> e = runWith(tempDir, List.of(
                response(ONE_STEP_PLAN),
                response("第一版结果"),
                response("{\"approved\": false, \"summary\": \"不行\", \"issues\": [\"缺少证据\"]}"),
                response("第二版结果"),
                response("{\"approved\": true, \"summary\": \"这回可以\", \"issues\": []}"))).events;

        assertEquals(2, count(e, "reviewStarted:"), "两轮审查该有两次 reviewStarted: " + e);
        assertEquals(2, count(e, "reviewCompleted:"), "两轮审查该有两次 reviewCompleted: " + e);
        assertTrue(e.contains("reviewCompleted:step_1:approved=false"), "第一轮该报未通过: " + e);
        assertTrue(e.contains("reviewCompleted:step_1:approved=true"), "第二轮该报通过: " + e);
    }

    @Test
    @DisplayName("审查阶段 LLM 调用失败也必须发 reviewCompleted —— 否则 UI 永远停在「审查中…」")
    void llmFailureStillClosesTheReview() {
        // 只给两条响应:planner 与 worker。reviewer 那次 chat 拿不到预设 → IOException → ERROR
        List<String> e = runWith(tempDir, List.of(
                response(ONE_STEP_PLAN),
                response("分析结果内容"))).events;

        assertEquals(1, count(e, "reviewStarted:"), "该发过 reviewStarted: " + e);
        assertEquals(1, count(e, "reviewCompleted:"),
                "审查失败也是「不再运行」;不发这条,UI 会永远显示「审查中…」: " + e);
        assertTrue(e.contains("reviewCompleted:step_1:approved=false"),
                "LLM 失败这条路代码按「未通过但保留结果」处理,回调要与之一致: " + e);
    }

    @Test
    @DisplayName("步骤根本没跑起来(前置失败被跳过)时不发任何 review 回调")
    void skippedStepEmitsNoReviewCallbacks() {
        List<String> e = runWith(tempDir, List.of(
                response("""
                        {"summary":"两步","steps":[
                          {"id":"s1","description":"第一步","type":"COMMAND","dependencies":[]},
                          {"id":"s2","description":"第二步","type":"ANALYSIS","dependencies":["s1"]}]}
                        """),
                response(""))).events;   // worker 空结果 → s1 失败 → s2 跳过

        assertEquals(0, count(e, "reviewStarted:"), "没执行过就没有审查: " + e);
        assertEquals(0, count(e, "reviewCompleted:"), e.toString());
    }

    @Test
    @DisplayName("NOOP listener 有默认实现 —— 老实现方不必改就能编过")
    void noopListenerHasDefaults() {
        TeamProgressListener.NOOP.reviewStarted("s1");
        TeamProgressListener.NOOP.reviewCompleted("s1", true);
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
        public LlmClient.ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener)
                throws IOException {
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
