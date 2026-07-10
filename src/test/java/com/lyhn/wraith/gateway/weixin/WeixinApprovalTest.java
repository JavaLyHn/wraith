package com.lyhn.wraith.gateway.weixin;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WeixinApprovalTest {

    @Test
    void promptTextContainsToolNameAndKeys() {
        String p = WeixinApproval.promptText("shell");
        assertTrue(p.contains("shell"));
        assertTrue(p.contains("y") && p.contains("a") && p.contains("n"));
    }

    @Test
    void promptTextNullToolFallsBackGeneric() {
        String p = WeixinApproval.promptText(null);
        assertFalse(p.contains("null"));
        assertTrue(p.contains("审批"));
    }

    @Test
    void parseYaN() {
        assertTrue(WeixinApproval.parse("y").isApproved());
        assertFalse(WeixinApproval.parse("y").isApprovedAll());
        assertTrue(WeixinApproval.parse("A").isApprovedAll());
        assertFalse(WeixinApproval.parse(" n ").isApproved());
    }

    @Test
    void parseOtherReturnsNull() {
        assertNull(WeixinApproval.parse("yes"));
        assertNull(WeixinApproval.parse(""));
        assertNull(WeixinApproval.parse(null));
    }
}
