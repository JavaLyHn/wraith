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
}
