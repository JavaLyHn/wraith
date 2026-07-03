package com.lyhn.wraith.session;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    // --- Task 2: image parts 落盘占位 ---

    /**
     * 含 image part 的 user 消息:序列化后无 image、text parts 拼接保留。
     * 反序列化得到的消息 content 包含占位文字，不含 base64。
     */
    @Test
    void roundTripsUserMessageWithImageDropsBase64AndPreservesText() throws Exception {
        List<LlmClient.ContentPart> parts = List.of(
                LlmClient.ContentPart.text("附件图片: foo.png"),
                LlmClient.ContentPart.imageBase64("AAAABASE64DATA", "image/png"),
                LlmClient.ContentPart.text("请分析这张图片")
        );
        LlmClient.Message msg = LlmClient.Message.user(parts);
        LlmClient.Message back = roundTrip(msg);

        assertEquals("user", back.role());
        // text parts 必须保留
        assertTrue(back.content().contains("附件图片: foo.png"), "应保留文件名占位文字");
        assertTrue(back.content().contains("请分析这张图片"), "应保留用户输入文字");
        // base64 数据不能落盘
        assertFalse(back.content().contains("AAAABASE64DATA"), "base64 数据不得落盘");
        // 反序列化后无 contentParts
        assertNull(back.contentParts());
    }

    /**
     * 纯文本 user 消息 round-trip 不变。
     */
    @Test
    void roundTripsPureTextUserMessageUnchanged() throws Exception {
        LlmClient.Message msg = LlmClient.Message.user("纯文本消息，无图片");
        LlmClient.Message back = roundTrip(msg);

        assertEquals("user", back.role());
        assertEquals("纯文本消息，无图片", back.content());
        assertNull(back.contentParts());
    }
}
