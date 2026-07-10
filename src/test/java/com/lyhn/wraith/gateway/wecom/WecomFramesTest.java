package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomFramesTest {
    private static final ObjectMapper M = new ObjectMapper();

    @Test
    void subscribeFrameShape() throws Exception {
        JsonNode n = M.readTree(WecomFrames.subscribeFrame("bot1", "sec1", "r1"));
        assertEquals("aibot_subscribe", n.get("cmd").asText());
        assertEquals("r1", n.path("headers").path("req_id").asText());
        assertEquals("bot1", n.path("body").path("bot_id").asText());
        assertEquals("sec1", n.path("body").path("secret").asText());
    }

    @Test
    void respondMarkdownFrameReusesReqIdAndEscapes() throws Exception {
        String tricky = "标题\n**粗**带\"引号\"";
        JsonNode n = M.readTree(WecomFrames.respondMarkdownFrame("rX", tricky)); // 非法 JSON 会抛
        assertEquals("aibot_respond_msg", n.get("cmd").asText());
        assertEquals("rX", n.path("headers").path("req_id").asText());
        assertEquals("markdown", n.path("body").path("msgtype").asText());
        assertEquals(tricky, n.path("body").path("markdown").path("content").asText());
    }

    @Test
    void pingFrame() throws Exception {
        JsonNode n = M.readTree(WecomFrames.pingFrame("p1"));
        assertEquals("ping", n.get("cmd").asText());
        assertEquals("p1", n.path("headers").path("req_id").asText());
    }

    @Test
    void parseCallbackExtractsFields() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"text\",\"text\":{\"content\":\"你好\"}}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertNotNull(in);
        assertEquals("R", in.reqId());
        assertEquals("U", in.userid());
        assertEquals("single", in.chatType());
        assertEquals("text", in.msgType());
        assertEquals("M", in.msgId());
        assertEquals("你好", in.text());
    }

    @Test
    void parseCallbackNonCallbackReturnsNull() {
        assertNull(WecomFrames.parseCallback("{\"cmd\":\"ping\",\"headers\":{\"req_id\":\"x\"}}"));
        assertNull(WecomFrames.parseCallback("not json"));
        assertNull(WecomFrames.parseCallback(null));
    }

    @Test
    void parseCallbackNonTextHasNullText() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"image\"}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertNotNull(in);
        assertEquals("image", in.msgType());
        assertNull(in.text());
    }

    @Test
    void parseSubscribeResult() {
        String ok = "{\"headers\":{\"req_id\":\"S\"},\"errcode\":0}";
        String bad = "{\"headers\":{\"req_id\":\"S\"},\"errcode\":40001,\"errmsg\":\"invalid secret\"}";
        String other = "{\"headers\":{\"req_id\":\"OTHER\"},\"errcode\":0}";
        assertEquals(WecomFrames.SubResult.SUBSCRIBED, WecomFrames.parseSubscribeResult(ok, "S"));
        assertEquals(WecomFrames.SubResult.AUTH_FAILED, WecomFrames.parseSubscribeResult(bad, "S"));
        assertEquals(WecomFrames.SubResult.UNKNOWN, WecomFrames.parseSubscribeResult(other, "S"));
        assertEquals(WecomFrames.SubResult.UNKNOWN, WecomFrames.parseSubscribeResult("not json", "S"));
    }

    @Test
    void parseCallbackExtractsChatId() {
        String json = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chatid\":\"C1\",\"chattype\":\"single\","
            + "\"from\":{\"userid\":\"U\"},\"msgtype\":\"text\",\"text\":{\"content\":\"hi\"}}}";
        WecomFrames.Inbound in = WecomFrames.parseCallback(json);
        assertEquals("C1", in.chatId());
    }

    @Test
    void parseCardEventExtractsKeyTaskOperator() {
        String json = "{\"cmd\":\"aibot_event_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgtype\":\"event\",\"from\":{\"userid\":\"OP\"},"
            + "\"event\":{\"eventtype\":\"template_card_event\",\"event_key\":\"approve_once\",\"task_id\":\"S1\"}}}";
        WecomFrames.CardEvent ev = WecomFrames.parseCardEvent(json);
        assertNotNull(ev);
        assertEquals("approve_once", ev.eventKey());
        assertEquals("S1", ev.taskId());
        assertEquals("OP", ev.operatorUserid());
    }

    @Test
    void parseCardEventNonEventReturnsNull() {
        assertNull(WecomFrames.parseCardEvent("{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"}}"));
        assertNull(WecomFrames.parseCardEvent("not json"));
        assertNull(WecomFrames.parseCardEvent(null));
    }

    @Test
    void respondCardFrameEmbedsCardObjectReusingReqId() throws Exception {
        String card = "{\"card_type\":\"button_interaction\",\"task_id\":\"S1\"}";
        JsonNode n = M.readTree(WecomFrames.respondCardFrame("rX", card));
        assertEquals("aibot_respond_msg", n.get("cmd").asText());
        assertEquals("rX", n.path("headers").path("req_id").asText());
        assertEquals("template_card", n.path("body").path("msgtype").asText());
        assertEquals("button_interaction", n.path("body").path("template_card").path("card_type").asText());
    }

    @Test
    void sendMarkdownFrameTargetsChatId() throws Exception {
        JsonNode n = M.readTree(WecomFrames.sendMarkdownFrame("C9", "文本"));
        assertEquals("aibot_send_msg", n.get("cmd").asText());
        assertEquals("C9", n.path("body").path("chatid").asText());
        assertEquals("markdown", n.path("body").path("msgtype").asText());
        assertEquals("文本", n.path("body").path("markdown").path("content").asText());
        assertFalse(n.path("headers").path("req_id").asText().isEmpty());
    }

    @Test
    void sendCardFrameTargetsChatIdEmbedsCard() throws Exception {
        String card = "{\"card_type\":\"button_interaction\"}";
        JsonNode n = M.readTree(WecomFrames.sendCardFrame("C9", card));
        assertEquals("aibot_send_msg", n.get("cmd").asText());
        assertEquals("C9", n.path("body").path("chatid").asText());
        assertEquals("template_card", n.path("body").path("msgtype").asText());
        assertEquals("button_interaction", n.path("body").path("template_card").path("card_type").asText());
    }
}
