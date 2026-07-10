package com.lyhn.wraith.gateway.weixin;

import com.lyhn.wraith.hitl.ApprovalResult;

import java.util.Locale;

/**
 * 微信文本 HITL:审批提示文案 + 主人回复解析(y/a/n)。个人微信无按钮/卡片,
 * 审批走纯文本三键协议;非 y/a/n 由 WeixinInbound 判为 APPROVAL_NUDGE(重提醒)。
 */
public final class WeixinApproval {

    private WeixinApproval() {}

    /** 审批提示文案;toolName 空则用通用文案。 */
    public static String promptText(String toolName) {
        String what = toolName == null || toolName.isBlank() ? "工具操作" : toolName;
        return "⚠️ 需要审批:" + what + "。回复 y 批准 / a 总是允许 / n 拒绝";
    }

    /** 解析主人回复:y/a/n(忽略大小写与空白);其它返回 null。 */
    public static ApprovalResult parse(String text) {
        if (text == null) return null;
        return switch (text.trim().toLowerCase(Locale.ROOT)) {
            case "y" -> ApprovalResult.approve();
            case "a" -> ApprovalResult.approveAll();
            case "n" -> ApprovalResult.reject("用户在微信拒绝");
            default -> null;
        };
    }
}
