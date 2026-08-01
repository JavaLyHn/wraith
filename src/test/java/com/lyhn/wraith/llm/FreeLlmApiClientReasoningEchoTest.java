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
 * freellmapi 网关后面常挂思考型模型(如 deepseek-v4-pro)。这类模型在 thinking mode 下
 * 要求把上一条 assistant 的 reasoning_content 原样回传,否则下一次调用直接 400:
 *   "The `reasoning_content` in the thinking mode must be passed back to the API."
 *
 * 症状是「只要这一轮调过工具就必炸」—— 因为工具轮才会有第二次 LLM 调用。真机复现于
 * 2026-08-01(newapi / deepseek-v4-pro)。
 */
class FreeLlmApiClientReasoningEchoTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static MockResponse okStream() {
        return new MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("""
                        data: {"choices":[{"delta":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}

                        data: [DONE]

                        """);
    }

    @Test
    void echoesReasoningContentBackForAssistantHistory() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            FreeLlmApiClient client =
                    new FreeLlmApiClient("k", "deepseek-v4-pro", server.url("/v1").toString());

            client.chat(List.of(
                    LlmClient.Message.user("你当前配置了哪些 im?"),
                    LlmClient.Message.assistant("我先查一下配置。", "稍等", List.of()),
                    LlmClient.Message.tool("call_1", "{\"qq\":true}")
            ), null);

            RecordedRequest request = server.takeRequest();
            JsonNode assistant = MAPPER.readTree(request.getBody().readUtf8())
                    .path("messages").get(1);

            assertTrue(assistant.has("reasoning_content"),
                    "思考型模型要求回传 reasoning_content,缺失会让工具轮的第二次调用 400");
            assertEquals("我先查一下配置。", assistant.path("reasoning_content").asText());
        }
    }

    @Test
    void omitsReasoningContentWhenModelNeverProducedAny() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(okStream());
            FreeLlmApiClient client =
                    new FreeLlmApiClient("k", "some-plain-model", server.url("/v1").toString());

            // 非思考型模型不会产出 reasoning_content;不能凭空捏造一个字段塞给它。
            client.chat(List.of(LlmClient.Message.assistant("纯文本回答")), null);

            RecordedRequest request = server.takeRequest();
            JsonNode assistant = MAPPER.readTree(request.getBody().readUtf8())
                    .path("messages").get(0);

            assertFalse(assistant.has("reasoning_content"),
                    "模型没产出 reasoning 时不应无中生有地加字段");
        }
    }
}
