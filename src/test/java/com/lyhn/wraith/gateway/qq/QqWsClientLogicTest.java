package com.lyhn.wraith.gateway.qq;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QqWsClientLogicTest {
    @Test void identifyCarriesTokenAndIntents() {
        String p = QqWsClient.identifyPayload("QQBot TOK", QqWsClient.INTENTS_C2C_AND_INTERACTION);
        assertTrue(p.contains("\"op\":2"));
        assertTrue(p.contains("QQBot TOK"));
        assertTrue(p.contains("\"intents\":" + QqWsClient.INTENTS_C2C_AND_INTERACTION));
    }
    @Test void resumeCarriesSessionAndSeq() {
        String p = QqWsClient.resumePayload("QQBot TOK", "SID", 42);
        assertTrue(p.contains("\"op\":6"));
        assertTrue(p.contains("\"session_id\":\"SID\""));
        assertTrue(p.contains("\"seq\":42"));
    }
    @Test void backoffSequenceThenCaps() {
        assertEquals(2, QqWsClient.backoffSeconds(0));
        assertEquals(5, QqWsClient.backoffSeconds(1));
        assertEquals(10, QqWsClient.backoffSeconds(2));
        assertEquals(30, QqWsClient.backoffSeconds(3));
        assertEquals(60, QqWsClient.backoffSeconds(4));
        assertEquals(60, QqWsClient.backoffSeconds(99));
    }
    @Test void threeQuickDisconnectsFatal() {
        assertTrue(QqWsClient.isFatalQuickDisconnect(new long[]{1000,2000,3000}));
        assertFalse(QqWsClient.isFatalQuickDisconnect(new long[]{1000,9000,1000}));
    }
}
