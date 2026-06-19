package com.lyhn.wraith.session;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SessionMessageCodecTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private LlmClient.Message roundTrip(LlmClient.Message msg) throws Exception {
        String json = mapper.writeValueAsString(SessionMessageCodec.toJson(mapper, msg));
        return SessionMessageCodec.fromJson(mapper.readTree(json));
    }

    @Test
    void roundTripsAssistantWithToolCalls() throws Exception {
        LlmClient.Message back = roundTrip(LlmClient.Message.assistant(
                "thinking...", "call a tool",
                List.of(new LlmClient.ToolCall("call_1",
                        new LlmClient.ToolCall.Function("read_file", "{\"path\":\"a.txt\"}")))));
        assertEquals("assistant", back.role());
        assertEquals("call a tool", back.content());
        assertEquals("thinking...", back.reasoningContent());
        assertEquals(1, back.toolCalls().size());
        assertEquals("call_1", back.toolCalls().get(0).id());
        assertEquals("read_file", back.toolCalls().get(0).function().name());
        assertEquals("{\"path\":\"a.txt\"}", back.toolCalls().get(0).function().arguments());
    }

    @Test
    void roundTripsToolResult() throws Exception {
        LlmClient.Message back = roundTrip(LlmClient.Message.tool("call_1", "file contents"));
        assertEquals("tool", back.role());
        assertEquals("file contents", back.content());
        assertEquals("call_1", back.toolCallId());
    }

    @Test
    void roundTripsUserMessage() throws Exception {
        LlmClient.Message back = roundTrip(LlmClient.Message.user("hello"));
        assertEquals("user", back.role());
        assertEquals("hello", back.content());
        assertNull(back.toolCalls());
        assertNull(back.toolCallId());
    }

    @Test
    void returnsNullForRolelessNode() throws Exception {
        assertNull(SessionMessageCodec.fromJson(mapper.readTree("{\"content\":\"x\"}")));
    }
}
