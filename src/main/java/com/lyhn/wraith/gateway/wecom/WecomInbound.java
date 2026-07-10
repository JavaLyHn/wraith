package com.lyhn.wraith.gateway.wecom;

import com.lyhn.wraith.gateway.qq.InboundMsg;

/**
 * 企微入站消息分类(纯逻辑,复刻 FeishuInbound 语义)。
 * 仅处理 chattype=single;PROCESS 时 InboundMsg.msgId 用 frame.reqId,承载回复关联。
 */
public final class WecomInbound {

    private WecomInbound() {}

    public enum Kind { IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result ignore()        { return new Result(Kind.IGNORE, null); }
        static Result pairingEcho()   { return new Result(Kind.PAIRING_ECHO, null); }
        static Result nonTextNotice() { return new Result(Kind.NONTEXT_NOTICE, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(WecomFrames.Inbound f, boolean ownerBound, boolean isOwner, long nowMs) {
        if (f == null || f.userid() == null || f.userid().isBlank()) return Result.ignore();
        if (!"single".equals(f.chatType())) return Result.ignore();
        if (!isOwner) return ownerBound ? Result.ignore() : Result.pairingEcho();
        if (!"text".equals(f.msgType())) return Result.nonTextNotice();
        String text = f.text();
        if (text == null || text.isBlank()) return Result.ignore();
        return Result.process(new InboundMsg(f.userid(), text, f.reqId(), nowMs));
    }
}
