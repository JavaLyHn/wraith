package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.hitl.ApprovalResult;

import java.util.Map;

/**
 * 飞书 HITL:构造 card 2.0 审批卡(approve-once / allow-always / deny 三按钮),
 * 解析按钮回调的 value payload。按钮 value 形如 {"a":"approve|deny","scope":"once|always","s":"<sessionKey>"}。
 * card.action.trigger 回调经 WS 长连接送达(见 FeishuProvider)。
 */
public final class FeishuApproval {

    private static final ObjectMapper M = new ObjectMapper();

    private FeishuApproval() {}

    public record Callback(String sessionKey, ApprovalResult result) {}

    /** 构造审批卡 JSON。{@code promptText} 为顶部说明,{@code sessionKey} 嵌进每个按钮的 value。 */
    public static String cardJson(String sessionKey, String promptText) {
        ObjectNode root = M.createObjectNode();
        root.put("schema", "2.0");
        ObjectNode body = root.putObject("body");
        ArrayNode elements = body.putArray("elements");

        ObjectNode md = elements.addObject();
        md.put("tag", "markdown");
        md.put("content", promptText);

        ObjectNode action = elements.addObject();
        action.put("tag", "action");
        ArrayNode actions = action.putArray("actions");
        actions.add(button("✅ 批准一次", "primary", "approve", "once", sessionKey));
        actions.add(button("✅ 总是允许", "primary", "approve", "always", sessionKey));
        actions.add(button("⛔ 拒绝", "danger", "deny", "once", sessionKey));

        try {
            return M.writeValueAsString(root);
        } catch (Exception e) {
            // ObjectNode 序列化不会失败;兜底返回极简卡防 NPE。
            return "{\"schema\":\"2.0\",\"body\":{\"elements\":[]}}";
        }
    }

    private static ObjectNode button(String label, String type, String a, String scope, String sessionKey) {
        ObjectNode btn = M.createObjectNode();
        btn.put("tag", "button");
        ObjectNode text = btn.putObject("text");
        text.put("tag", "plain_text");
        text.put("content", label);
        btn.put("type", type);
        ObjectNode value = btn.putObject("value");
        value.put("a", a);
        value.put("scope", scope);
        value.put("s", sessionKey);
        return btn;
    }

    /** 解按钮 value → Callback;非法/缺字段返回 null。 */
    public static Callback parse(Map<String, Object> value) {
        if (value == null) return null;
        Object a = value.get("a");
        Object scope = value.get("scope");
        Object s = value.get("s");
        if (!(s instanceof String) || ((String) s).isEmpty()) return null;
        ApprovalResult r;
        if ("approve".equals(a)) {
            r = "always".equals(scope) ? ApprovalResult.approveAll() : ApprovalResult.approve();
        } else if ("deny".equals(a)) {
            r = ApprovalResult.reject("用户在飞书拒绝");
        } else {
            return null;
        }
        return new Callback((String) s, r);
    }
}
