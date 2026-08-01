package com.lyhn.wraith.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * reasoning_content 必须回传 —— 这一条对**所有** OpenAI 兼容 client 成立，不能只挂在
 * 某几个具名 client 上。
 *
 * 上一版只覆写了 FreeLlmApiClient，结果对真实用户毫无作用:配置里的 provider id 是
 * `freellmapi-2`(多实例编号)，normalizeProvider 不做后缀归一 → switch 落到 default
 * → 实际拿到的是 GenericOpenAiClient。真机复现:工具调用后的第二次请求 400。
 */
class ReasoningEchoAcrossClientsTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static MockResponse okStream() {
        return new MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("""
                        data: {"choices":[{"delta":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}

                        data: [DONE]

                        """);
    }

    private static JsonNode firstMessage(MockWebServer server) throws Exception {
        RecordedRequest req = server.takeRequest();
        return MAPPER.readTree(req.getBody().readUtf8()).path("messages").get(0);
    }

    /** 用户实际命中的类:provider id 带实例后缀时工厂给的就是它。 */
    @Test
    void genericOpenAiClientEchoesReasoning() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            GenericOpenAiClient client = new GenericOpenAiClient(
                    "k", "deepseek-v4-pro", server.url("/v1").toString(), "freellmapi-2");

            client.chat(List.of(LlmClient.Message.assistant("思考内容", "答案")), null);

            JsonNode msg = firstMessage(server);
            assertTrue(msg.has("reasoning_content"),
                    "GenericOpenAiClient 不回传 reasoning_content —— freellmapi-2 这类实例 id 正是走它");
            assertEquals("思考内容", msg.path("reasoning_content").asText());
        }
    }

    @Test
    void freeLlmApiClientEchoesReasoning() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            new FreeLlmApiClient("k", "m", server.url("/v1").toString())
                    .chat(List.of(LlmClient.Message.assistant("思考内容", "答案")), null);
            assertTrue(firstMessage(server).has("reasoning_content"));
        }
    }

    /** 没有 reasoning 就不该凭空造一个字段 —— 对所有 client 都成立。 */
    @Test
    void noFabricationWhenModelProducedNothing() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            new GenericOpenAiClient("k", "m", server.url("/v1").toString(), "x")
                    .chat(List.of(LlmClient.Message.assistant("纯文本")), null);
            assertFalse(firstMessage(server).has("reasoning_content"));
        }
    }

    /** 工具轮才是真正出事的场景:assistant(带 reasoning + toolCalls) → tool → 第二次请求。 */
    @Test
    void echoesOnToolCallTurn() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            LlmClient.ToolCall call = new LlmClient.ToolCall(
                    "c1", new LlmClient.ToolCall.Function("im_status", "{}"));
            new GenericOpenAiClient("k", "m", server.url("/v1").toString(), "freellmapi-2")
                    .chat(List.of(
                            LlmClient.Message.user("配了哪些 im"),
                            LlmClient.Message.assistant("先查一下", "", List.of(call)),
                            LlmClient.Message.tool("c1", "{\"qq\":true}")
                    ), null);

            RecordedRequest req = server.takeRequest();
            JsonNode assistant = MAPPER.readTree(req.getBody().readUtf8()).path("messages").get(1);
            assertTrue(assistant.has("reasoning_content"), "工具轮的 assistant 消息丢了 reasoning → 下一次请求 400");
            assertTrue(assistant.has("tool_calls"), "tool_calls 不能被顺带弄丢");
        }
    }
}
