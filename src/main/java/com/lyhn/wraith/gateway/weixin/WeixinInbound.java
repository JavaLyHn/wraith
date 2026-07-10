package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import com.lyhn.wraith.wechat.WechatMessage;

import java.util.Locale;

/**
 * 微信入站消息分类(纯逻辑)。扫码者即主人(boundUserId),非主人一律 IGNORE(fail-closed,
 * 无配对回显)。挂起文本审批时,y/a/n 判为 APPROVAL_REPLY、其余判 APPROVAL_NUDGE(Phase B 消费;
 * Phase A 调用方恒传 hasPendingApproval=false)。PROCESS 时 InboundMsg.msgId 用 contextToken
 * 承载回复关联;去重由调用方以 messageId 在 classify 之前完成。
 */
public final class WeixinInbound {

    private WeixinInbound() {}

    public enum Kind { IGNORE, NONTEXT_NOTICE, APPROVAL_REPLY, APPROVAL_NUDGE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result of(Kind k) { return new Result(k, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(WechatMessage m, String boundUserId, boolean hasPendingApproval, long nowMs) {
        if (m == null || m.fromUserId() == null || m.fromUserId().isBlank()) return Result.of(Kind.IGNORE);
        if (boundUserId == null || !boundUserId.equals(m.fromUserId())) return Result.of(Kind.IGNORE);
        String text = m.text() == null ? "" : m.text().trim();
        if (text.isEmpty() && m.mediaItems() != null && !m.mediaItems().isEmpty()) {
            return Result.of(Kind.NONTEXT_NOTICE);
        }
        if (hasPendingApproval) {
            String t = text.toLowerCase(Locale.ROOT);
            return ("y".equals(t) || "a".equals(t) || "n".equals(t))
                    ? Result.of(Kind.APPROVAL_REPLY)
                    : Result.of(Kind.APPROVAL_NUDGE);
        }
        if (text.isEmpty()) return Result.of(Kind.IGNORE);
        return Result.process(new InboundMsg(m.fromUserId(), text, m.contextToken(), nowMs));
    }
}
