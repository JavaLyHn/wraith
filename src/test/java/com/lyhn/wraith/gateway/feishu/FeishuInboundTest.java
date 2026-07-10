package com.lyhn.wraith.gateway.feishu;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FeishuInboundTest {

    private static final String TEXT = "{\"text\":\"你好\"}";

    @Test
    void nullOrBlankOpenIdIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify(null, "p2p", "text", "om_1", TEXT, true, true, 1L).kind());
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("  ", "p2p", "text", "om_1", TEXT, true, true, 1L).kind());
    }

    @Test
    void groupChatIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_a", "group", "text", "om_1", TEXT, true, true, 1L).kind());
    }

    @Test
    void unknownSenderWhenUnboundGetsPairingEcho() {
        assertEquals(FeishuInbound.Kind.PAIRING_ECHO,
                FeishuInbound.classify("ou_a", "p2p", "text", "om_1", TEXT, false, false, 1L).kind());
    }

    @Test
    void unknownSenderWhenBoundIsIgnored() {
        // owner 已绑定但来的不是 owner → deny-all,静默忽略(不回显)
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_stranger", "p2p", "text", "om_1", TEXT, true, false, 1L).kind());
    }

    @Test
    void ownerNonTextGetsNotice() {
        assertEquals(FeishuInbound.Kind.NONTEXT_NOTICE,
                FeishuInbound.classify("ou_owner", "p2p", "image", "om_1", "{\"image_key\":\"x\"}", true, true, 1L).kind());
    }

    @Test
    void ownerTextIsProcessedIntoInboundMsg() {
        FeishuInbound.Result r =
                FeishuInbound.classify("ou_owner", "p2p", "text", "om_9", TEXT, true, true, 4242L);
        assertEquals(FeishuInbound.Kind.PROCESS, r.kind());
        InboundMsg m = r.msg();
        assertNotNull(m);
        assertEquals("ou_owner", m.openid());
        assertEquals("你好", m.text());
        assertEquals("om_9", m.msgId());
        assertEquals(4242L, m.ts());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(FeishuInbound.Kind.IGNORE,
                FeishuInbound.classify("ou_owner", "p2p", "text", "om_1", "{\"text\":\"   \"}", true, true, 1L).kind());
    }

    @Test
    void extractTextParsesTextField() {
        assertEquals("你好", FeishuInbound.extractText(TEXT));
        assertNull(FeishuInbound.extractText("{\"nope\":1}"));
        assertNull(FeishuInbound.extractText("not json"));
        assertNull(FeishuInbound.extractText(null));
    }
}
