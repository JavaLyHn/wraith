package com.lyhn.wraith.gateway.qq;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqApprovalTest {
    @Test void keyboardHasThreeButtons() {
        String j = QqApproval.keyboardJson("sess-1");
        assertTrue(j.contains("approve:sess-1:allow-once"));
        assertTrue(j.contains("approve:sess-1:allow-always"));
        assertTrue(j.contains("approve:sess-1:deny"));
    }
    @Test void parseMapsDecisions() {
        assertEquals(ApprovalResult.Decision.APPROVED, QqApproval.parse("approve:s:allow-once").result().decision());
        assertEquals(ApprovalResult.Decision.APPROVED_ALL, QqApproval.parse("approve:s:allow-always").result().decision());
        assertEquals(ApprovalResult.Decision.REJECTED, QqApproval.parse("approve:s:deny").result().decision());
        assertEquals("s", QqApproval.parse("approve:s:deny").sessionKey());
        assertNull(QqApproval.parse("garbage"));
    }
}
