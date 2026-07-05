package com.lyhn.wraith.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Anthropic messages 协议客户端。v1:阻塞请求;流式 = 阻塞后一次性吐 content。 */
public class AnthropicClient implements LlmClient {
    private static final ObjectMapper M = new ObjectMapper();
    private static final MediaType JSON = MediaType.get("application/json");
    private static final String DEFAULT_BASE = "https://api.anthropic.com";
    private static final String VERSION = "2023-06-01";

    private final String apiKey, model, messagesUrl;

    public AnthropicClient(String apiKey, String model, String baseUrl) {
        this.apiKey = apiKey;
        this.model = model != null ? model.trim() : "";
        String b = (baseUrl == null || baseUrl.isBlank()) ? DEFAULT_BASE : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        this.messagesUrl = b.endsWith("/v1/messages") ? b : b + "/v1/messages";
    }

    @Override public String getModelName()    { return model; }
    @Override public String getProviderName() { return "anthropic"; }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
        ObjectNode body = buildRequestBody(M, model, 8192, messages, tools);
        Request req = new Request.Builder().url(messagesUrl)
                .header("x-api-key", apiKey)
                .header("anthropic-version", VERSION)
                .post(RequestBody.create(M.writeValueAsString(body), JSON))
                .build();
        try (Response resp = AbstractOpenAiCompatibleClient.SHARED_HTTP_CLIENT.newCall(req).execute()) {
            String s = resp.body() != null ? resp.body().string() : "";
            if (!resp.isSuccessful()) throw new IOException("Anthropic " + resp.code() + ": " + s);
            return parseResponse(M, M.readTree(s));
        }
    }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
        ChatResponse r = chat(messages, tools);           // v1:阻塞
        if (listener != null && r.content() != null && !r.content().isEmpty())
            listener.onContentDelta(r.content());         // 一次性吐出
        return r;
    }

    // ---- 可单测的纯函数 ----

    /** 构造 anthropic 请求体:system 提顶层,其余映射 messages;tools→input_schema。 */
    static ObjectNode buildRequestBody(ObjectMapper m, String model, int maxTokens,
                                       List<Message> messages, List<Tool> tools) {
        ObjectNode body = m.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        StringBuilder sys = new StringBuilder();
        ArrayNode msgs = body.putArray("messages");
        for (Message msg : messages) {
            if ("system".equals(msg.role())) {
                if (msg.content() != null) { if (sys.length() > 0) sys.append("\n\n"); sys.append(msg.content()); }
                continue;
            }
            ObjectNode mm = msgs.addObject();
            if ("tool".equals(msg.role())) {
                // 工具结果 → user 消息里的 tool_result block
                mm.put("role", "user");
                ArrayNode content = mm.putArray("content");
                ObjectNode tr = content.addObject();
                tr.put("type", "tool_result");
                tr.put("tool_use_id", msg.toolCallId() != null ? msg.toolCallId() : "");
                tr.put("content", msg.content() != null ? msg.content() : "");
                continue;
            }
            mm.put("role", "assistant".equals(msg.role()) ? "assistant" : "user");
            if (msg.toolCalls() != null && !msg.toolCalls().isEmpty()) {
                // assistant 带工具调用 → text block(可选) + tool_use blocks
                ArrayNode content = mm.putArray("content");
                if (msg.content() != null && !msg.content().isBlank()) {
                    ObjectNode tb = content.addObject(); tb.put("type", "text"); tb.put("text", msg.content());
                }
                for (ToolCall tc : msg.toolCalls()) {
                    ObjectNode tu = content.addObject();
                    tu.put("type", "tool_use");
                    tu.put("id", tc.id());
                    tu.put("name", tc.function().name());
                    try { tu.set("input", m.readTree(tc.function().arguments() == null || tc.function().arguments().isBlank()
                            ? "{}" : tc.function().arguments())); }
                    catch (Exception e) { tu.set("input", m.createObjectNode()); }
                }
            } else {
                mm.put("content", msg.content() != null ? msg.content() : "");
            }
        }
        if (sys.length() > 0) body.put("system", sys.toString());
        if (tools != null && !tools.isEmpty()) {
            ArrayNode ts = body.putArray("tools");
            for (Tool t : tools) {
                ObjectNode to = ts.addObject();
                to.put("name", t.name());
                if (t.description() != null) to.put("description", t.description());
                to.set("input_schema", t.parameters() != null ? t.parameters() : m.createObjectNode());
            }
        }
        return body;
    }

    /** 解析 anthropic 响应:text block 拼 content;tool_use → ToolCall(arguments=JSON 串)。 */
    static ChatResponse parseResponse(ObjectMapper m, JsonNode resp) {
        StringBuilder text = new StringBuilder();
        List<ToolCall> calls = new ArrayList<>();
        JsonNode content = resp.get("content");
        if (content != null && content.isArray()) {
            for (JsonNode block : content) {
                String type = block.path("type").asText();
                if ("text".equals(type)) text.append(block.path("text").asText());
                else if ("tool_use".equals(type)) {
                    String args = block.has("input") ? block.get("input").toString() : "{}";
                    calls.add(new ToolCall(block.path("id").asText(),
                            new ToolCall.Function(block.path("name").asText(), args)));
                }
            }
        }
        int in = resp.path("usage").path("input_tokens").asInt(0);
        int out = resp.path("usage").path("output_tokens").asInt(0);
        return new ChatResponse("assistant", text.toString(), calls, in, out);
    }
}
