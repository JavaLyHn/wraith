package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.wechat.WechatMediaItem;
import com.lyhn.wraith.wechat.WechatMessage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WeixinInboundTest {

    private WechatMessage msg(String from, String text) {
        return new WechatMessage("MID1", from, "CTX1", text, List.of());
    }

    @Test
    void ownerTextProcessesWithContextTokenAsMsgId() {
        var r = WeixinInbound.classify(msg("OWNER", "你好"), "OWNER", false, 42L);
        assertEquals(WeixinInbound.Kind.PROCESS, r.kind());
        assertEquals("OWNER", r.msg().openid());
        assertEquals("你好", r.msg().text());
        assertEquals("CTX1", r.msg().msgId(), "msgId 应为 contextToken 以承载回复关联");
        assertEquals(42L, r.msg().ts());
    }

    @Test
    void nonOwnerIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("STRANGER", "hi"), "OWNER", false, 0L).kind());
    }

    @Test
    void blankFromIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("", "hi"), "OWNER", false, 0L).kind());
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(null, "OWNER", false, 0L).kind());
    }

    @Test
    void mediaOnlyGetsNonTextNotice() {
        WechatMessage media = new WechatMessage("MID2", "OWNER", "CTX2", "",
                List.of(new WechatMediaItem("image", null, "image/png", "q", "k")));
        assertEquals(WeixinInbound.Kind.NONTEXT_NOTICE,
                WeixinInbound.classify(media, "OWNER", false, 0L).kind());
    }

    @Test
    void ownerBlankTextIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("OWNER", "   "), "OWNER", false, 0L).kind());
    }

    @Test
    void pendingApprovalYanAreReplies() {
        for (String t : new String[]{"y", "Y", "a", "N", " n "}) {
            assertEquals(WeixinInbound.Kind.APPROVAL_REPLY,
                    WeixinInbound.classify(msg("OWNER", t), "OWNER", true, 0L).kind(), "输入: " + t);
        }
    }

    @Test
    void pendingApprovalOtherTextIsNudge() {
        assertEquals(WeixinInbound.Kind.APPROVAL_NUDGE,
                WeixinInbound.classify(msg("OWNER", "帮我跑个测试"), "OWNER", true, 0L).kind());
    }

    @Test
    void pendingApprovalNonOwnerStillIgnored() {
        assertEquals(WeixinInbound.Kind.IGNORE,
                WeixinInbound.classify(msg("STRANGER", "y"), "OWNER", true, 0L).kind());
    }
}
