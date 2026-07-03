package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.skill.SkillContextBuffer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentClearHistoryTest {

    @TempDir
    Path tempDir;

    @Test
    void clearHistoryRebuildsSystemPromptAndDropsPendingSkillContext() {
        String oldMemoryDir = System.getProperty("wraith.memory.dir");
        System.setProperty("wraith.memory.dir", tempDir.toString());
        try {
            RecordingClient llmClient = new RecordingClient(List.of(
                    new LlmClient.ChatResponse("assistant", "ok", null, 50_000, 1_000)
            ));
            Agent agent = new Agent(llmClient);
            SkillContextBuffer skillContextBuffer = new SkillContextBuffer();
            agent.setSkillContextBuffer(skillContextBuffer);
            agent.getMemoryManager().storeFact("CLEAR_MARKER should only appear when retrieved", "project");

            agent.run("CLEAR_MARKER");

            assertTrue(llmClient.firstSystemPrompt().contains("CLEAR_MARKER"),
                    "sanity check: the first turn should inject query-specific long-term memory");
            long beforeClearTokens = agent.currentStatus("idle").totalTokens();

            skillContextBuffer.push("demo", "pending skill body");
            agent.clearHistory();

            List<LlmClient.Message> history = agent.getConversationHistory();
            assertEquals(1, history.size());
            assertFalse(history.get(0).content().contains("CLEAR_MARKER"),
                    "/clear must not preserve the previous query's retrieved memory in system prompt");
            assertFalse(history.get(0).content().contains("## 相关长期记忆"));
            assertEquals("", skillContextBuffer.drain(), "/clear should drop pending skill injection");
            assertTrue(agent.currentStatus("idle").totalTokens() < beforeClearTokens,
                    "status ctx should reflect the cleared conversation instead of the previous LLM usage");
        } finally {
            if (oldMemoryDir == null) {
                System.clearProperty("wraith.memory.dir");
            } else {
                System.setProperty("wraith.memory.dir", oldMemoryDir);
            }
        }
    }

    /**
     * run(String, List<ContentPart>, List<String>) 后末条 user 消息应是 parts 结构，
     * 包含文件名占位文字 part、image part，以及 userInput text part。
     */
    @Test
    void runWithImagePartsAddsPartsUserMessageToHistory() {
        String oldMemoryDir = System.getProperty("wraith.memory.dir");
        System.setProperty("wraith.memory.dir", tempDir.toString());
        try {
            RecordingClient llmClient = new RecordingClient(List.of(
                    new LlmClient.ChatResponse("assistant", "已分析图片。", null, 10, 5)
            ));
            Agent agent = new Agent(llmClient);

            List<LlmClient.ContentPart> imageParts = List.of(
                    LlmClient.ContentPart.imageBase64("FAKEBASE64", "image/png")
            );
            List<String> imageNames = List.of("screenshot.png");

            agent.run("请描述图片内容", imageParts, imageNames);

            List<LlmClient.Message> history = agent.getConversationHistory();
            // 最后一条 user 消息（倒数第二条：user + assistant 的顺序）
            LlmClient.Message lastUser = history.stream()
                    .filter(m -> "user".equals(m.role()))
                    .reduce((a, b) -> b)
                    .orElse(null);
            assertNotNull(lastUser, "history 中应有 user 消息");
            assertTrue(lastUser.hasContentParts(), "重载后末条 user 消息应有 contentParts");
            // parts 中应包含文件名占位
            boolean hasNamePart = lastUser.contentParts().stream()
                    .anyMatch(p -> p.isText() && p.text() != null && p.text().contains("screenshot.png"));
            assertTrue(hasNamePart, "parts 中应含 '附件图片: screenshot.png' 文字 part");
            // parts 中应包含 image part
            boolean hasImagePart = lastUser.contentParts().stream()
                    .anyMatch(LlmClient.ContentPart::isImage);
            assertTrue(hasImagePart, "parts 中应含 image part");
            // parts 中应包含用户文字
            boolean hasUserText = lastUser.contentParts().stream()
                    .anyMatch(p -> p.isText() && p.text() != null && p.text().contains("请描述图片内容"));
            assertTrue(hasUserText, "parts 中应含用户输入文字");
        } finally {
            if (oldMemoryDir == null) {
                System.clearProperty("wraith.memory.dir");
            } else {
                System.setProperty("wraith.memory.dir", oldMemoryDir);
            }
        }
    }

    private static final class RecordingClient implements LlmClient {
        private final Queue<ChatResponse> responses;
        private final List<List<Message>> capturedMessages = new ArrayList<>();

        private RecordingClient(List<ChatResponse> responses) {
            this.responses = new ArrayDeque<>(responses);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            capturedMessages.add(List.copyOf(messages));
            ChatResponse response = responses.poll();
            if (response == null) {
                throw new IOException("缺少预设响应");
            }
            return response;
        }

        @Override
        public String getModelName() {
            return "test-model";
        }

        @Override
        public String getProviderName() {
            return "test";
        }

        @Override
        public int maxContextWindow() {
            return 256_000;
        }

        private String firstSystemPrompt() {
            return capturedMessages.get(0).get(0).content();
        }
    }
}
