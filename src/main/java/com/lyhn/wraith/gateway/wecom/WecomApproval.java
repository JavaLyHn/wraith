package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.hitl.ApprovalResult;

/**
 * 企微 HITL:构造 button_interaction 审批卡(批准一次 / 总是允许 / 拒绝)+ 解析按钮点击事件。
 * 按钮 key ∈ {approve_once, approve_always, deny};卡片 task_id 承载 sessionKey。
 * 事件经 aibot_event_callback(template_card_event)送达(见 WecomProvider)。
 */
public final class WecomApproval {

    private static final ObjectMapper M = new ObjectMapper();

    private WecomApproval() {}

    public record Callback(String sessionKey, ApprovalResult result) {}

    public static String cardJson(String sessionKey, String promptText) {
        ObjectNode card = M.createObjectNode();
        card.put("card_type", "button_interaction");
        ObjectNode mainTitle = card.putObject("main_title");
        mainTitle.put("title", "需要审批");
        mainTitle.put("desc", promptText == null ? "" : promptText);
        card.put("task_id", sessionKey);
        ArrayNode buttons = card.putArray("button_list");
        buttons.add(button("✅ 批准一次", 1, "approve_once"));
        buttons.add(button("✅ 总是允许", 1, "approve_always"));
        buttons.add(button("⛔ 拒绝", 2, "deny"));
        try {
            return M.writeValueAsString(card);
        } catch (Exception e) {
            return "{\"card_type\":\"button_interaction\"}";
        }
    }

    private static ObjectNode button(String text, int style, String key) {
        ObjectNode b = M.createObjectNode();
        b.put("text", text);
        b.put("style", style);
        b.put("key", key);
        return b;
    }

    public static Callback parse(WecomFrames.CardEvent ev) {
        if (ev == null) return null;
        String s = ev.taskId();
        if (s == null || s.isEmpty()) return null;
        ApprovalResult r;
        switch (ev.eventKey() == null ? "" : ev.eventKey()) {
            case "approve_once" -> r = ApprovalResult.approve();
            case "approve_always" -> r = ApprovalResult.approveAll();
            case "deny" -> r = ApprovalResult.reject("用户在企微拒绝");
            default -> { return null; }
        }
        return new Callback(s, r);
    }
}
