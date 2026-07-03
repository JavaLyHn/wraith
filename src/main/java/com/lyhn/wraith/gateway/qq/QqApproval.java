package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.hitl.ApprovalResult;

public final class QqApproval {
    private QqApproval() {}
    public record Callback(String sessionKey, ApprovalResult result) {}

    public static String keyboardJson(String sessionKey) {
        // QQ inline keyboard:三个 callback(action.type=1)按钮,group 互斥
        String btn = "{\"id\":\"%s\",\"render_data\":{\"label\":\"%s\",\"style\":%d}," +
                "\"action\":{\"type\":1,\"data\":\"approve:%s:%s\",\"permission\":{\"type\":1}}}";
        String once   = String.format(btn, "1", "✅ 批准一次", 1, sessionKey, "allow-once");
        String always = String.format(btn, "2", "✅ 总是允许", 1, sessionKey, "allow-always");
        String deny   = String.format(btn, "3", "⛔ 拒绝", 2, sessionKey, "deny");
        return "{\"content\":{\"rows\":[{\"buttons\":[" + once + "," + always + "," + deny + "]}]}}";
    }

    public static Callback parse(String buttonData) {
        if (buttonData == null) return null;
        String[] p = buttonData.split(":", 3);
        if (p.length != 3 || !"approve".equals(p[0])) return null;
        ApprovalResult r = switch (p[2]) {
            case "allow-once" -> ApprovalResult.approve();
            case "allow-always" -> ApprovalResult.approveAll();
            case "deny" -> ApprovalResult.reject("用户在 QQ 拒绝");
            default -> null;
        };
        return r == null ? null : new Callback(p[1], r);
    }
}
