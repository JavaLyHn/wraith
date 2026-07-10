package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomInboundTest {
    private WecomFrames.Inbound f(String userid, String chatType, String msgType, String text) {
        return new WecomFrames.Inbound("REQ1", userid, chatType, "C1", msgType, "MSG1", text);
    }

    @Test
    void ownerTextProcessesWithReqIdAsMsgId() {
        var r = WecomInbound.classify(f("U", "single", "text", "你好"), true, true, 42L);
        assertEquals(WecomInbound.Kind.PROCESS, r.kind());
        InboundMsg m = r.msg();
        assertEquals("U", m.openid());
        assertEquals("你好", m.text());
        assertEquals("REQ1", m.msgId(), "msgId 应为 reqId 以承载回复关联");
        assertEquals(42L, m.ts());
    }

    @Test
    void groupChatIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "group", "text", "hi"), true, true, 0L).kind());
    }

    @Test
    void blankUseridIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("", "single", "text", "hi"), true, true, 0L).kind());
    }

    @Test
    void unknownSenderUnboundGetsPairingEcho() {
        assertEquals(WecomInbound.Kind.PAIRING_ECHO,
            WecomInbound.classify(f("U", "single", "text", "hi"), false, false, 0L).kind());
    }

    @Test
    void unknownSenderBoundIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "single", "text", "hi"), true, false, 0L).kind());
    }

    @Test
    void ownerNonTextGetsNotice() {
        assertEquals(WecomInbound.Kind.NONTEXT_NOTICE,
            WecomInbound.classify(f("U", "single", "image", null), true, true, 0L).kind());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(WecomInbound.Kind.IGNORE,
            WecomInbound.classify(f("U", "single", "text", "   "), true, true, 0L).kind());
    }
}
