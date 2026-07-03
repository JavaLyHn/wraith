package com.lyhn.wraith.gateway.qq;
import com.fasterxml.jackson.databind.JsonNode;

public final class QqEvents {
    private QqEvents() {}
    public record Interaction(String id, String openid, String buttonData) {}

    public static InboundMsg parseC2C(JsonNode d) {
        String openid = d.path("author").path("user_openid").asText("");
        String text = d.path("content").asText("").trim();
        String msgId = d.path("id").asText("");
        return new InboundMsg(openid, text, msgId, System.currentTimeMillis());
    }

    public static Interaction parseInteraction(JsonNode d) {
        String id = d.path("id").asText("");
        String openid = d.path("user_openid").asText("");
        String btn = d.path("data").path("resolved").path("button_data").asText("");
        return new Interaction(id, openid, btn);
    }
}
