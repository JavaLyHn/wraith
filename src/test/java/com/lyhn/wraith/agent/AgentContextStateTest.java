package com.lyhn.wraith.agent;

import com.lyhn.wraith.context.curator.CurationMarks;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentContextStateTest {

    @TempDir
    Path tempDir;

    @Test
    void snapshotCarriesModelWindowAndLiveSummaryPreview() {
        withIsolatedMemoryDir(() -> {
            Agent agent = new Agent(new FakeClient());
            agent.restoreHistory(List.of(
                    LlmClient.Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n这是活摘要正文"),
                    LlmClient.Message.assistant("好的，我已了解之前的上下文，请继续。"),
                    LlmClient.Message.user("继续干活")));
            Map<String, Object> m = agent.contextStateCore();
            assertEquals("fake-model", m.get("model"));
            assertEquals(64_000L, m.get("contextWindow"));
            assertTrue(((String) m.get("liveSummary")).contains("这是活摘要正文"));
            assertEquals("idle", m.get("phase"));
            assertTrue((Long) m.get("totalTokens") > 0);
        });
    }

    @Test
    void liveSummaryNullWhenAbsent() {
        withIsolatedMemoryDir(() -> {
            Agent agent = new Agent(new FakeClient());
            assertNull(agent.contextStateCore().get("liveSummary"));
        });
    }

    /**
     * 回合运行中(turnActive=true)时 conversationHistory 正被 turn 线程写,contextStateCore
     * 的 history 派生字段(totalTokens/liveSummary)必须降级为骨架帧,不做无锁读——防 CME。
     * Agent 未暴露 turnActive 的 setter,同包用反射直接改私有字段(最小侵入)。
     */
    @Test
    void degradesToSkeletonFrameWhenTurnActive() {
        withIsolatedMemoryDir(() -> {
            Agent agent = new Agent(new FakeClient());
            agent.restoreHistory(List.of(
                    LlmClient.Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n这是活摘要正文"),
                    LlmClient.Message.assistant("好的，我已了解之前的上下文，请继续。")));
            setTurnActive(agent, true);
            Map<String, Object> m = agent.contextStateCore();
            assertEquals(0L, m.get("totalTokens"));
            assertNull(m.get("liveSummary"));
            assertEquals("running", m.get("phase"));
        });
    }

    /**
     * setLlmClient 换模型应立即推一帧富状态(修"换模型不刷新"),但仅限非回合期——
     * 回合运行中 conversationHistory 正被 turn 线程写,estimateCurrentContextTokens() 无锁读
     * 有 CME 风险(与 contextStateCore 同一守卫),此时跳过推送,交给运行中 turn 的下一帧自然带上新模型。
     */
    @Test
    void setLlmClientPushesRichIdleFrameOnlyWhenNotInTurn() {
        withIsolatedMemoryDir(() -> {
            Agent agent = new Agent(new FakeClient());
            CapturingRenderer renderer = new CapturingRenderer();
            agent.setRenderer(renderer);

            agent.setLlmClient(new FakeClient2());

            assertEquals(1, renderer.statuses.size());
            StatusInfo frame = renderer.statuses.get(0);
            assertEquals("fake-model-2", frame.model());
            assertEquals("idle", frame.phase());

            setTurnActive(agent, true);
            agent.setLlmClient(new FakeClient());

            assertEquals(1, renderer.statuses.size(), "回合运行中 setLlmClient 不应再推新帧(CME 守卫)");
        });
    }

    private static void setTurnActive(Agent agent, boolean value) {
        try {
            java.lang.reflect.Field f = Agent.class.getDeclaredField("turnActive");
            f.setAccessible(true);
            f.set(agent, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Agent 构造经 MemoryManager -&gt; LongTermMemory 会在磁盘上创建/加载 wraith.memory.dir
     * (未设置时默认落在真实 ~/.wraith/memory)。仿照 AgentClearHistoryTest / AgentMemoryHintTest
     * 的既有先例：临时接管该系统属性指向 @TempDir，测试结束还原，避免写真实用户目录。
     */
    private void withIsolatedMemoryDir(Runnable body) {
        String oldMemoryDir = System.getProperty("wraith.memory.dir");
        System.setProperty("wraith.memory.dir", tempDir.toString());
        try {
            body.run();
        } finally {
            if (oldMemoryDir == null) {
                System.clearProperty("wraith.memory.dir");
            } else {
                System.setProperty("wraith.memory.dir", oldMemoryDir);
            }
        }
    }

    private static final class FakeClient implements LlmClient {
        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public String getModelName() {
            return "fake-model";
        }

        @Override
        public String getProviderName() {
            return "fake";
        }

        @Override
        public int maxContextWindow() {
            return 64_000;
        }

        @Override
        public boolean supportsTools() {
            return false;
        }
    }

    /** 换模型目标——不同 model 名,便于断言 setLlmClient 推送的富帧确实带上了新模型。 */
    private static final class FakeClient2 implements LlmClient {
        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            throw new UnsupportedOperationException("FakeClient2 does not perform real chat calls");
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            throw new UnsupportedOperationException("FakeClient2 does not perform real chat calls");
        }

        @Override
        public String getModelName() {
            return "fake-model-2";
        }

        @Override
        public String getProviderName() {
            return "fake2";
        }

        @Override
        public int maxContextWindow() {
            return 128_000;
        }

        @Override
        public boolean supportsTools() {
            return false;
        }
    }

    /** 最小 Renderer 测试替身:只收集 updateStatus 收到的帧,其余方法均 no-op。 */
    private static final class CapturingRenderer implements Renderer {
        final List<StatusInfo> statuses = new ArrayList<>();
        private final PrintStream stream = new PrintStream(OutputStream.nullOutputStream());

        @Override
        public void start() {
        }

        @Override
        public void close() {
        }

        @Override
        public PrintStream stream() {
            return stream;
        }

        @Override
        public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
        }

        @Override
        public void appendDiff(String filePath, String before, String after) {
        }

        @Override
        public void updateStatus(StatusInfo status) {
            statuses.add(status);
        }

        @Override
        public ApprovalResult promptApproval(ApprovalRequest request) {
            return ApprovalResult.reject("test");
        }

        @Override
        public int openPalette(String title, List<String> items) {
            return -1;
        }
    }
}
