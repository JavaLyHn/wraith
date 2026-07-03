package com.lyhn.wraith.gateway.qq;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class QqApiClientTest {
    MockWebServer server;
    @BeforeEach void up() throws Exception { server = new MockWebServer(); server.start(); }
    @AfterEach void down() throws Exception { server.shutdown(); }

    private QqApiClient client() {
        String base = server.url("/").toString().replaceAll("/$","");
        return new QqApiClient("APP","SECRET", base, base + "/app/getAppAccessToken", new OkHttpClient());
    }

    @Test void fetchesAndCachesToken() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}"));
        QqApiClient c = client();
        assertEquals("TOK", c.ensureToken());
        assertEquals("TOK", c.ensureToken());              // 第二次走缓存
        assertEquals(1, server.getRequestCount());          // 未二次请求 token
    }

    @Test void multiChunkPutsMsgIdOnFirstChunkOnly() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}"));
        server.enqueue(new MockResponse().setBody("{\"id\":\"a\"}"));
        server.enqueue(new MockResponse().setBody("{\"id\":\"b\"}"));
        client().sendC2C("OPENID_A", "a".repeat(4500), "MSG1");  // 4500 chars, no newline → exactly 2 chunks
        server.takeRequest();                                      // token request
        RecordedRequest send1 = server.takeRequest();              // chunk 1
        RecordedRequest send2 = server.takeRequest();              // chunk 2
        String body1 = send1.getBody().readUtf8();
        String body2 = send2.getBody().readUtf8();
        assertTrue(body1.contains("\"msg_id\":\"MSG1\""),   "first chunk must carry msg_id");
        assertFalse(body2.contains("msg_id"),               "second chunk must NOT carry msg_id");
        assertTrue(body1.contains("\"msg_seq\""),           "first chunk must carry msg_seq");
        assertTrue(body2.contains("\"msg_seq\""),           "second chunk must carry msg_seq");
    }

    @Test void sendC2cPostsPassiveReply() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"access_token\":\"TOK\",\"expires_in\":7200}"));
        server.enqueue(new MockResponse().setBody("{\"id\":\"x\"}"));
        client().sendC2C("OPENID_A", "hi", "MSG1");
        server.takeRequest();                               // token 请求
        RecordedRequest send = server.takeRequest();
        assertEquals("/v2/users/OPENID_A/messages", send.getPath());
        assertTrue(send.getHeader("Authorization").startsWith("QQBot "));
        String body = send.getBody().readUtf8();
        assertTrue(body.contains("\"content\":\"hi\""));
        assertTrue(body.contains("\"msg_id\":\"MSG1\""));   // 被动回复
        assertTrue(body.contains("\"msg_seq\""));
    }
}
