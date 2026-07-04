package com.lyhn.wraith.gateway.qq;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 回归防护：审批按钮消息（{@code sendC2CWithKeyboard}）的 body 必须用 {@code markdown} 对象，
 * 而非把文案放顶层 {@code content} 纯串——后者在真 QQ C2C 返回
 * HTTP 400「无效 markdown content」(code 40034011)，会让 HITL 审批彻底发不出去。
 */
class QqApiClientKeyboardTest {

    private MockWebServer server;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath();
                if (path != null && path.contains("getAppAccessToken")) {
                    return new MockResponse().setBody("{\"access_token\":\"tok\",\"expires_in\":7200}");
                }
                return new MockResponse().setBody("{\"id\":\"m1\"}"); // /messages
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    @Test
    void keyboardBodyWrapsTextInMarkdownObject() throws Exception {
        String base = server.url("/").toString().replaceAll("/$", "");
        String tokenUrl = server.url("/getAppAccessToken").toString();
        QqApiClient api = new QqApiClient("appid", "secret", base, tokenUrl, new OkHttpClient());

        api.sendC2CWithKeyboard("openid-1", "需要审批", "MSG_1", QqApproval.keyboardJson("sess-1"));

        // 顺序：先 token 请求，后 /messages —— 取到 /messages 那条
        String body = null;
        RecordedRequest r;
        while ((r = server.takeRequest(1, TimeUnit.SECONDS)) != null) {
            if (r.getPath() != null && r.getPath().contains("/messages")) {
                body = r.getBody().readUtf8();
                break;
            }
        }

        assertNotNull(body, "应发出一条 /messages 请求");
        assertTrue(body.contains("\"msg_type\":2"), "keyboard 消息应为 msg_type=2:" + body);
        assertTrue(body.contains("\"markdown\":{\"content\":\"需要审批\"}"),
                "文案必须包在 markdown 对象内（否则 QQ 400 无效 markdown content）:" + body);
        assertTrue(body.contains("\"keyboard\""), "应携带 keyboard 对象:" + body);
        assertTrue(body.contains("\"msg_id\":\"MSG_1\""), "应带被动回复 msg_id:" + body);
    }
}
