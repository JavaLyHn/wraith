package com.lyhn.wraith.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.llm.LlmClient;

import java.util.ArrayList;
import java.util.List;

/**
 * {@link LlmClient.Message} ↔ JSON 编解码(会话持久化用)。
 *
 * <p>只落盘 user/assistant/tool 的文本上下文:role / content / reasoningContent /
 * toolCallId / toolCalls(id+name+arguments)。不持久化 system 消息(由新进程重建),
 * 也不持久化图片二进制(contentParts)——调用方应先 {@code withoutImageContent()}。
 */
public final class SessionMessageCodec {

    private SessionMessageCodec() {
    }

    /** 把一条消息序列化为 JSON 节点。 */
    public static ObjectNode toJson(ObjectMapper mapper, LlmClient.Message m) {
        ObjectNode node = mapper.createObjectNode();
        node.put("role", m.role());
        node.put("content", m.content());
        if (m.reasoningContent() != null) {
            node.put("reasoningContent", m.reasoningContent());
        }
        if (m.toolCallId() != null) {
            node.put("toolCallId", m.toolCallId());
        }
        List<LlmClient.ToolCall> toolCalls = m.toolCalls();
        if (toolCalls != null && !toolCalls.isEmpty()) {
            ArrayNode arr = node.putArray("toolCalls");
            for (LlmClient.ToolCall tc : toolCalls) {
                if (tc == null) {
                    continue;
                }
                ObjectNode t = arr.addObject();
                t.put("id", tc.id());
                if (tc.function() != null) {
                    t.put("name", tc.function().name());
                    t.put("arguments", tc.function().arguments());
                }
            }
        }
        return node;
    }

    /** 从 JSON 节点重建一条消息;非法节点返回 {@code null}(坏行跳过)。 */
    public static LlmClient.Message fromJson(JsonNode node) {
        if (node == null || !node.hasNonNull("role")) {
            return null;
        }
        String role = node.get("role").asText();
        String content = node.hasNonNull("content") ? node.get("content").asText() : null;
        String reasoning = node.hasNonNull("reasoningContent") ? node.get("reasoningContent").asText() : null;
        String toolCallId = node.hasNonNull("toolCallId") ? node.get("toolCallId").asText() : null;
        List<LlmClient.ToolCall> toolCalls = null;
        JsonNode arr = node.get("toolCalls");
        if (arr != null && arr.isArray() && !arr.isEmpty()) {
            toolCalls = new ArrayList<>();
            for (JsonNode t : arr) {
                String id = t.hasNonNull("id") ? t.get("id").asText() : null;
                String name = t.hasNonNull("name") ? t.get("name").asText() : null;
                String args = t.hasNonNull("arguments") ? t.get("arguments").asText() : null;
                toolCalls.add(new LlmClient.ToolCall(id, new LlmClient.ToolCall.Function(name, args)));
            }
        }
        return new LlmClient.Message(role, content, reasoning, toolCalls, toolCallId);
    }
}
