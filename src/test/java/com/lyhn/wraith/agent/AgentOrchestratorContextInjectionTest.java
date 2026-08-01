package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AgentOrchestratorContextInjectionTest {

    /** 捕获第一次 chat() 的出站 messages,返回空计划(让 run 尽快收尾/或抛错由调用方吞)。 */
    private static final class RecordingClient implements LlmClient {
        List<Message> firstMessages = null;
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }
        @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (firstMessages == null) firstMessages = new ArrayList<>(messages);
            listener.finish();
            return new ChatResponse("assistant", "{}", null, 1, 1);
        }
        @Override public String getModelName() { return "stub"; }
        @Override public String getProviderName() { return "stub"; }
    }

    private static String plannerTaskText(RecordingClient c) {
        // planner 任务在最后一条 user 消息(system 是角色提示词)
        Message last = c.firstMessages.get(c.firstMessages.size() - 1);
        return last.content();
    }

    @Test
    void whenContextSet_plannerTaskContainsInjectedBlock() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        orch.setConversationContext("用户: 克隆仓库\n助手: 已完成");
        try { orch.run("继续"); } catch (Exception ignored) { }
        String task = plannerTaskText(c);
        assertTrue(task.startsWith(ConversationDigest.INJECT_PREFIX), task);
        assertTrue(task.contains("用户: 克隆仓库"), task);
        assertTrue(task.endsWith("请为以下任务制定执行计划：\n继续"), task);
    }

    @Test
    void whenContextEmpty_plannerTaskByteIdenticalToBaseline() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        // 不调 setConversationContext,或设空
        orch.setConversationContext("");
        try { orch.run("继续"); } catch (Exception ignored) { }
        assertEquals("请为以下任务制定执行计划：\n继续", plannerTaskText(c));
    }

    // ── worker 执行层也要拿到主线对话 digest(修复:切模式后 worker 曾看不到前文) ──

    @Test
    void buildStepContext_whenContextSet_containsConversationDigest() {
        AgentOrchestrator orch = new AgentOrchestrator(new RecordingClient());
        orch.setConversationContext("用户: 克隆仓库\n助手: 已完成");
        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "跑命令", "command", List.of()));
        assertTrue(ctx.startsWith(ConversationDigest.INJECT_PREFIX), ctx);
        assertTrue(ctx.contains("用户: 克隆仓库"), ctx);
        assertTrue(ctx.contains("总任务上下文"), ctx);
    }

    @Test
    void buildStepContext_whenContextEmpty_noDigestPrefix() {
        AgentOrchestrator orch = new AgentOrchestrator(new RecordingClient());
        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "跑命令", "command", List.of()));
        assertFalse(ctx.contains(ConversationDigest.INJECT_PREFIX), ctx);
        assertTrue(ctx.startsWith("总任务上下文"), ctx);
    }

    // ── worker 必须知道「总任务是什么」 ────────────────────────────────────
    // 真机 bug:问 https://github.com/JavaLyHn/Hyeto 有多少内容,planner 明确推理要用
    // web_fetch,但 worker 收到的只有一句「获取仓库根目录页面」——buildStepContext 打了
    // 「总任务上下文:」这个标题却从不写入总任务本身。worker 于是把「仓库」理解成当前
    // 工作目录,一路 list_dir/glob_files/read_file,分析了本地文件夹。
    @Test
    void buildStepContext_carriesTheOverallGoalNotJustAHeader() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        String goal = "https://github.com/JavaLyHn/Hyeto 帮我看一下这里有多少内容";
        try { orch.run(goal); } catch (Exception ignored) { }

        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "获取仓库根目录页面", "web", List.of()));
        assertTrue(ctx.contains("github.com/JavaLyHn/Hyeto"),
                "worker 上下文里没有总任务/URL,它只能靠猜 —— 这就是分析成本地目录的原因: " + ctx);
        assertTrue(ctx.contains("总任务上下文"), ctx);
    }

    @Test
    void buildStepContext_goalSurvivesAlongsideDependencyResults() {
        RecordingClient c = new RecordingClient();
        AgentOrchestrator orch = new AgentOrchestrator(c);
        try { orch.run("分析 https://example.com/repo 的规模"); } catch (Exception ignored) { }

        AgentOrchestrator.ExecutionStep done = AgentOrchestrator.ExecutionStep
                .pending("s1", "取根目录", "web", List.of())
                .withResult("根目录有 4 个文件");
        AgentOrchestrator.ExecutionStep next = AgentOrchestrator.ExecutionStep
                .pending("s2", "遍历子目录", "web", List.of("s1"));

        String ctx = orch.buildStepContext(List.of(done), next);
        assertTrue(ctx.contains("example.com/repo"), "有依赖结果时总任务同样不能丢: " + ctx);
        assertTrue(ctx.contains("根目录有 4 个文件"), ctx);
    }

    /** 没跑过 run() 时(单测直接调)不该塞进空的「总任务」行。 */
    @Test
    void buildStepContext_noGoalLineWhenGoalUnknown() {
        AgentOrchestrator orch = new AgentOrchestrator(new RecordingClient());
        String ctx = orch.buildStepContext(
                List.of(),
                AgentOrchestrator.ExecutionStep.pending("s1", "跑命令", "command", List.of()));
        assertTrue(ctx.startsWith("总任务上下文"), ctx);
        assertFalse(ctx.contains("总任务："), "goal 未知时不该留一行空的「总任务:」: " + ctx);
    }
}
