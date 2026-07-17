package com.lyhn.wraith.agent;

import com.lyhn.wraith.context.curator.CurationMarks;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
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
}
