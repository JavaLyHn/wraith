package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
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
 * 思考型模型(deepseek-v4-pro 等)在 thinking mode 下要求把 assistant 的 reasoning_content
 * 原样回传,缺了就 400:"The `reasoning_content` in the thinking mode must be passed back."
 *
 * 有工具调用那条分支一直是带上的;**收尾那条(无工具调用、直接出答案)此前用的是单参
 * assistant(content),把 reasoning 丢了** —— 于是本轮能过、下一轮读到这条残缺历史就炸。
 * 2026-08-01 真机复现:第 4 轮正常,第 5 轮 400。
 */
class AgentReasoningHistoryTest {

    @Test
    void keepsReasoningContentOnFinalAssistantMessageAcrossTurns(@TempDir Path tempDir) {
        RecordingClient llm = new RecordingClient(List.of(
                new LlmClient.ChatResponse("assistant", "第一轮答案", "第一轮的思考", null, 10, 2),
                new LlmClient.ChatResponse("assistant", "第二轮答案", "第二轮的思考", null, 10, 2)
        ));
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(llm, registry);

        agent.run("第一个问题");
        agent.run("第二个问题");

        assertEquals(2, llm.messagesByCall.size());
        List<LlmClient.Message> secondCall = llm.messagesByCall.get(1);
        LlmClient.Message carried = secondCall.stream()
                .filter(m -> "assistant".equals(m.role()))
                .reduce((a, b) -> b)
                .orElseThrow(() -> new AssertionError("第二轮请求里没有上一轮的 assistant 消息"));

        assertEquals("第一轮答案", carried.content());
        assertTrue(carried.reasoningContent() != null && !carried.reasoningContent().isBlank(),
                "收尾 assistant 消息丢了 reasoning_content —— 思考型模型下一轮会 400");
        assertEquals("第一轮的思考", carried.reasoningContent());
    }

    @Test
    void doesNotFabricateReasoningWhenModelProducedNone(@TempDir Path tempDir) {
        RecordingClient llm = new RecordingClient(List.of(
                new LlmClient.ChatResponse("assistant", "纯文本答案", null, 10, 2),
                new LlmClient.ChatResponse("assistant", "第二轮", null, 10, 2)
        ));
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(llm, registry);

        agent.run("问题一");
        agent.run("问题二");

        LlmClient.Message carried = llm.messagesByCall.get(1).stream()
                .filter(m -> "assistant".equals(m.role()))
                .reduce((a, b) -> b)
                .orElseThrow();
        assertTrue(carried.reasoningContent() == null || carried.reasoningContent().isBlank(),
                "模型没产出 reasoning 就不该无中生有");
    }

    private static final class RecordingClient implements LlmClient {
        private final Queue<ChatResponse> responses;
        private final List<List<Message>> messagesByCall = new ArrayList<>();

        private RecordingClient(List<ChatResponse> responses) {
            this.responses = new ArrayDeque<>(responses);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            messagesByCall.add(List.copyOf(messages));
            ChatResponse response = responses.poll();
            if (response == null) {
                throw new IOException("缺少预设响应");
            }
            return response;
        }

        @Override
        public String getModelName() {
            return "test-thinking-model";
        }

        @Override
        public String getProviderName() {
            return "test";
        }
    }
}
