package com.lyhn.wraith.gateway.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WecomApprovalTest {
    private static final ObjectMapper M = new ObjectMapper();

    @Test
    void cardJsonIsButtonInteractionWithSessionKeyAndThreeButtons() throws Exception {
        JsonNode c = M.readTree(WecomApproval.cardJson("S1", "需要审批:shell"));
        assertEquals("button_interaction", c.path("card_type").asText());
        assertEquals("S1", c.path("task_id").asText());
        JsonNode btns = c.path("button_list");
        assertEquals(3, btns.size());
        // 收集 key
        java.util.Set<String> keys = new java.util.HashSet<>();
        btns.forEach(b -> keys.add(b.path("key").asText()));
        assertTrue(keys.containsAll(java.util.Set.of("approve_once", "approve_always", "deny")));
    }

    @Test
    void parseApproveOnce() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("approve_once", "S1", "OP"));
        assertNotNull(cb);
        assertEquals("S1", cb.sessionKey());
        assertTrue(cb.result().isApproved());
        assertFalse(cb.result().isApprovedAll());
    }

    @Test
    void parseApproveAlways() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("approve_always", "S1", "OP"));
        assertTrue(cb.result().isApprovedAll());
    }

    @Test
    void parseDeny() {
        var cb = WecomApproval.parse(new WecomFrames.CardEvent("deny", "S1", "OP"));
        assertFalse(cb.result().isApproved());
    }

    @Test
    void parseUnknownOrMissingReturnsNull() {
        assertNull(WecomApproval.parse(new WecomFrames.CardEvent("bogus", "S1", "OP")));
        assertNull(WecomApproval.parse(new WecomFrames.CardEvent("approve_once", "", "OP")));
        assertNull(WecomApproval.parse(null));
    }
}
