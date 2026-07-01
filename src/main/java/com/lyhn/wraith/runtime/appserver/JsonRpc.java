package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** JSON-RPC 2.0 over JSONL：入站解析 + 共享 ObjectMapper。 */
public final class JsonRpc {
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonRpc() {}

    /** 一条入站消息；id 为 null 表示通知。 */
    public record Incoming(Object id, String method, JsonNode params) {
        public boolean isNotification() { return id == null; }
    }

    /** 解析一行 JSONL；非法或缺 method 返回 null。 */
    public static Incoming parse(String line) {
        try {
            JsonNode root = MAPPER.readTree(line);
            if (root == null || !root.hasNonNull("method")) return null;
            JsonNode idNode = root.get("id");
            Object id = (idNode == null || idNode.isNull()) ? null
                    : (idNode.isNumber() ? idNode.numberValue() : idNode.asText());
            return new Incoming(id, root.get("method").asText(), root.get("params"));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            return null;
        }
    }
}
