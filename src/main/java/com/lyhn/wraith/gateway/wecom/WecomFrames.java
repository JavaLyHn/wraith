package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 企微智能机器人长连接的帧构造与解析(纯函数,脱网单测)。
 * 帧信封:{@code {cmd?, headers:{req_id}, body?, errcode?, errmsg?}}。
 * 收发 JSON 用 Jackson(转义交给库,规避裸拼坏 JSON)。
 */
public final class WecomFrames {

    private static final ObjectMapper M = new ObjectMapper();

    private WecomFrames() {}

    /** 入站文本消息的关键字段;msgType!=text 时 text 为 null。 */
    public record Inbound(String reqId, String userid, String chatType,
                          String msgType, String msgId, String text) {}

    public enum SubResult { SUBSCRIBED, AUTH_FAILED, UNKNOWN }

    /** 订阅帧:aibot_subscribe(bot_id + secret)。 */
    public static String subscribeFrame(String botId, String secret, String reqId) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_subscribe");
        root.putObject("headers").put("req_id", reqId);
        ObjectNode body = root.putObject("body");
        body.put("bot_id", botId);
        body.put("secret", secret);
        return write(root, "{}");
    }

    /** 回复帧:aibot_respond_msg,msgtype=markdown,复用入站 reqId。 */
    public static String respondMarkdownFrame(String reqId, String content) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "aibot_respond_msg");
        root.putObject("headers").put("req_id", reqId);
        ObjectNode body = root.putObject("body");
        body.put("msgtype", "markdown");
        body.putObject("markdown").put("content", content == null ? "" : content);
        return write(root, "{\"cmd\":\"aibot_respond_msg\",\"headers\":{\"req_id\":\"" + reqId + "\"}}");
    }

    /** 心跳帧:ping。 */
    public static String pingFrame(String reqId) {
        ObjectNode root = M.createObjectNode();
        root.put("cmd", "ping");
        root.putObject("headers").put("req_id", reqId);
        return write(root, "{\"cmd\":\"ping\"}");
    }

    /** 解析入站 aibot_msg_callback;非该 cmd / 非法 → null。 */
    public static Inbound parseCallback(String json) {
        if (json == null) return null;
        try {
            JsonNode n = M.readTree(json);
            if (!"aibot_msg_callback".equals(n.path("cmd").asText())) return null;
            JsonNode body = n.path("body");
            String reqId = n.path("headers").path("req_id").asText(null);
            String userid = body.path("from").path("userid").asText(null);
            String chatType = body.path("chattype").asText(null);
            String msgType = body.path("msgtype").asText(null);
            String msgId = body.path("msgid").asText(null);
            String text = "text".equals(msgType) ? body.path("text").path("content").asText(null) : null;
            return new Inbound(reqId, userid, chatType, msgType, msgId, text);
        } catch (Exception e) {
            return null;
        }
    }

    /** 判定订阅结果:仅当帧 req_id == 我们的订阅 reqId 且带 errcode 时有效。 */
    public static SubResult parseSubscribeResult(String json, String subscribeReqId) {
        if (json == null) return SubResult.UNKNOWN;
        try {
            JsonNode n = M.readTree(json);
            String rid = n.path("headers").path("req_id").asText(null);
            if (rid == null || !rid.equals(subscribeReqId)) return SubResult.UNKNOWN;
            if (!n.has("errcode")) return SubResult.UNKNOWN;
            return n.path("errcode").asInt(-1) == 0 ? SubResult.SUBSCRIBED : SubResult.AUTH_FAILED;
        } catch (Exception e) {
            return SubResult.UNKNOWN;
        }
    }

    private static String write(ObjectNode root, String fallback) {
        try {
            return M.writeValueAsString(root);
        } catch (Exception e) {
            return fallback;
        }
    }
}
