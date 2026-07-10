package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class FeishuApprovalTest {

    private static Map<String, Object> value(String a, String scope, String s) {
        Map<String, Object> m = new HashMap<>();
        m.put("a", a);
        m.put("scope", scope);
        m.put("s", s);
        return m;
    }

    @Test
    void cardJsonIsValidCard2AndCarriesSessionKeyInEveryButton() throws Exception {
        String json = FeishuApproval.cardJson("sess-1", "⚠️ 需要审批:执行 shell?");
        JsonNode root = new ObjectMapper().readTree(json);
        assertEquals("2.0", root.get("schema").asText());
        JsonNode elements = root.get("body").get("elements");
        // 第 0 个是 markdown 提示,第 1 个是 action(含 3 按钮)
        JsonNode actions = elements.get(1).get("actions");
        assertEquals(3, actions.size());
        for (JsonNode btn : actions) {
            assertEquals("sess-1", btn.get("value").get("s").asText());
        }
        // 提示文本透传
        assertTrue(json.contains("执行 shell"));
    }

    @Test
    void parseAllowOnce() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("approve", "once", "sess-1"));
        assertNotNull(cb);
        assertEquals("sess-1", cb.sessionKey());
        assertTrue(cb.result().isApproved());
    }

    @Test
    void parseAllowAlwaysIsApproved() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("approve", "always", "sess-2"));
        assertNotNull(cb);
        assertTrue(cb.result().isApproved());
    }

    @Test
    void parseDenyIsNotApproved() {
        FeishuApproval.Callback cb = FeishuApproval.parse(value("deny", "once", "sess-3"));
        assertNotNull(cb);
        assertEquals("sess-3", cb.sessionKey());
        assertFalse(cb.result().isApproved());
    }

    @Test
    void parseGarbageReturnsNull() {
        assertNull(FeishuApproval.parse(value("bogus", "once", "s")));
        assertNull(FeishuApproval.parse(new HashMap<>()));
        assertNull(FeishuApproval.parse(null));
    }
}
