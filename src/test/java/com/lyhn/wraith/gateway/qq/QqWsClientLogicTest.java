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
    @Test void threeConsecutiveAuthFailsFatal() {
        assertTrue(QqWsClient.isFatalAuthLoop(new int[]{4004,4004,4004}));   // 连续 3 次认证失败 → 放弃
        assertFalse(QqWsClient.isFatalAuthLoop(new int[]{4004,-1,4004}));    // 中间夹网络断连 → 不放弃
        assertFalse(QqWsClient.isFatalAuthLoop(new int[]{-1,-1,-1}));        // 纯网络断连 → 不放弃(会恢复)
        assertFalse(QqWsClient.isFatalAuthLoop(new int[]{4004,4004}));       // 不足 3 次
    }

    // --- F-4:结构化连接状态 ---------------------------------------------

    @Test void connStateWireMapping() {
        assertEquals("connecting",   QqWsClient.ConnState.CONNECTING.wire());
        assertEquals("connected",    QqWsClient.ConnState.CONNECTED.wire());
        assertEquals("disconnected", QqWsClient.ConnState.DISCONNECTED.wire());
        assertEquals("auth-failed",  QqWsClient.ConnState.AUTH_FAILED.wire());
    }

    @Test void readyFrameEmitsConnected() {
        // READY = 认证通过、会话建立 → 应发射 CONNECTED(经 handleFrame 包私缝,不起真 socket)。
        QqWsClient ws = new QqWsClient(null, null);
        java.util.List<QqWsClient.ConnState> seen = new java.util.ArrayList<>();
        ws.setStateListener(seen::add);
        String ready = "{\"op\":0,\"s\":1,\"t\":\"READY\",\"d\":{\"session_id\":\"SID_1\"}}";
        ws.handleFrame(ready, null, m -> {}, i -> {}, new long[]{0});
        assertTrue(seen.contains(QqWsClient.ConnState.CONNECTED), "READY 应发射 CONNECTED, got=" + seen);
    }
}
