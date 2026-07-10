package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.gateway.qq.InboundMsg;

/**
 * 飞书入站消息分类(纯逻辑)。把「忽略 / 配对回显 / 非文本提示 / 正常处理」的决策与
 * SDK 事件解耦,便于单测;SDK getter 提取在 FeishuProvider 胶水里完成。
 *
 * <p>规则(依次):open_id 空 → IGNORE;非 p2p → IGNORE;非 owner → 未绑定则 PAIRING_ECHO、
 * 已绑定则 IGNORE(deny-all);owner 非文本 → NONTEXT_NOTICE;owner 文本为空 → IGNORE;
 * owner 文本 → PROCESS(InboundMsg)。
 */
public final class FeishuInbound {

    private static final ObjectMapper M = new ObjectMapper();

    private FeishuInbound() {}

    public enum Kind { IGNORE, PAIRING_ECHO, NONTEXT_NOTICE, PROCESS }

    public record Result(Kind kind, InboundMsg msg) {
        static Result ignore()        { return new Result(Kind.IGNORE, null); }
        static Result pairingEcho()   { return new Result(Kind.PAIRING_ECHO, null); }
        static Result nonTextNotice() { return new Result(Kind.NONTEXT_NOTICE, null); }
        static Result process(InboundMsg m) { return new Result(Kind.PROCESS, m); }
    }

    public static Result classify(String openId, String chatType, String msgType,
                                  String msgId, String contentJson,
                                  boolean ownerBound, boolean isOwner, long nowMs) {
        if (openId == null || openId.isBlank()) return Result.ignore();
        if (!"p2p".equals(chatType)) return Result.ignore();
        if (!isOwner) return ownerBound ? Result.ignore() : Result.pairingEcho();
        if (!"text".equals(msgType)) return Result.nonTextNotice();
        String text = extractText(contentJson);
        if (text == null || text.isBlank()) return Result.ignore();
        return Result.process(new InboundMsg(openId, text, msgId, nowMs));
    }

    /** 从飞书文本消息 content(JSON 串 {@code {"text":"..."}})提取纯文本;失败返回 null。 */
    public static String extractText(String contentJson) {
        if (contentJson == null) return null;
        try {
            JsonNode n = M.readTree(contentJson);
            JsonNode t = n.get("text");
            return t == null ? null : t.asText();
        } catch (Exception e) {
            return null;
        }
    }
}
