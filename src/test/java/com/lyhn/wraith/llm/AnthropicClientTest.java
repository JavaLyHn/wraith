package com.lyhn.wraith.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AnthropicClientTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void buildRequestExtractsSystemAndMapsMessages() throws Exception {
        var msgs = List.of(
            LlmClient.Message.system("你是助手"),
            LlmClient.Message.user("你好"),
            LlmClient.Message.assistant("在"));
        ObjectNode body = AnthropicClient.buildRequestBody(M, "claude-x", 8192, msgs, List.of());
        assertEquals("claude-x", body.get("model").asText());
        assertEquals("你是助手", body.get("system").asText());          // system 提到顶层
        assertEquals(2, body.get("messages").size());                    // system 不在 messages
        assertEquals("user", body.get("messages").get(0).get("role").asText());
        assertEquals("assistant", body.get("messages").get(1).get("role").asText());
    }

    @Test void buildRequestMapsToolsToAnthropicSchema() throws Exception {
        JsonNode params = M.readTree("{\"type\":\"object\",\"properties\":{}}");
        var tools = List.of(new LlmClient.Tool("read_file", "读文件", params));
        ObjectNode body = AnthropicClient.buildRequestBody(M, "m", 8192, List.of(LlmClient.Message.user("hi")), tools);
        JsonNode t0 = body.get("tools").get(0);
        assertEquals("read_file", t0.get("name").asText());
        assertEquals("读文件", t0.get("description").asText());
        assertTrue(t0.has("input_schema"));                              // anthropic 用 input_schema
    }

    @Test void parseResponseExtractsTextToolCallsUsage() throws Exception {
        JsonNode resp = M.readTree("""
          {"content":[{"type":"text","text":"结果"},
                      {"type":"tool_use","id":"tu_1","name":"read_file","input":{"path":"a"}}],
           "usage":{"input_tokens":10,"output_tokens":5}}""");
        LlmClient.ChatResponse r = AnthropicClient.parseResponse(M, resp);
        assertEquals("结果", r.content());
        assertTrue(r.hasToolCalls());
        assertEquals("read_file", r.toolCalls().get(0).function().name());
        assertEquals("{\"path\":\"a\"}", r.toolCalls().get(0).function().arguments());
        assertEquals(10, r.inputTokens());
        assertEquals(5, r.outputTokens());
    }

    @Test void buildRequestCoalescesConsecutiveToolResultsIntoSingleUserMessage() throws Exception {
        // 并行工具调用:1 条 assistant 带 2 个 tool_use,紧跟 2 条连续 tool 消息
        var toolCalls = List.of(
            new LlmClient.ToolCall("a", new LlmClient.ToolCall.Function("fn_a", "{}")),
            new LlmClient.ToolCall("b", new LlmClient.ToolCall.Function("fn_b", "{}"))
        );
        var msgs = List.of(
            LlmClient.Message.assistant(null, toolCalls),
            LlmClient.Message.tool("a", "result-a"),
            LlmClient.Message.tool("b", "result-b")
        );
        ObjectNode body = AnthropicClient.buildRequestBody(M, "claude-x", 8192, msgs, List.of());
        JsonNode messages = body.get("messages");

        // 应有 2 条消息:1 条 assistant(tool_use) + 1 条 user(tool_result x2)
        assertEquals(2, messages.size(), "两条连续 tool 消息应合并为一条 user 消息");

        JsonNode userMsg = messages.get(1);
        assertEquals("user", userMsg.get("role").asText());
        JsonNode content = userMsg.get("content");
        assertTrue(content.isArray(), "content 应为数组");
        assertEquals(2, content.size(), "user 消息的 content 应包含 2 个 tool_result block");

        assertEquals("tool_result", content.get(0).path("type").asText());
        assertEquals("a", content.get(0).path("tool_use_id").asText());
        assertEquals("tool_result", content.get(1).path("type").asText());
        assertEquals("b", content.get(1).path("tool_use_id").asText());

        // 验证没有连续两条 user 消息
        for (int i = 0; i < messages.size() - 1; i++) {
            boolean bothUser = "user".equals(messages.get(i).path("role").asText())
                    && "user".equals(messages.get(i + 1).path("role").asText());
            assertFalse(bothUser, "不应存在连续两条 role=user 的消息 (index " + i + " 和 " + (i + 1) + ")");
        }
    }
}
