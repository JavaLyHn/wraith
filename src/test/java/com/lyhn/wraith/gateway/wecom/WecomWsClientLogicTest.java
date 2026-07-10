package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class WecomWsClientLogicTest {

    private WecomWsClient client() {
        return new WecomWsClient(new OkHttpClient(), "bot1", "sec1");
    }

    @Test
    void handleFrameDispatchesCallbackToInbound() {
        List<WecomFrames.Inbound> got = new ArrayList<>();
        String cb = "{\"cmd\":\"aibot_msg_callback\",\"headers\":{\"req_id\":\"R\"},"
            + "\"body\":{\"msgid\":\"M\",\"chattype\":\"single\",\"from\":{\"userid\":\"U\"},"
            + "\"msgtype\":\"text\",\"text\":{\"content\":\"hi\"}}}";
        client().handleFrame(cb, got::add, t -> {});
        assertEquals(1, got.size());
        assertEquals("U", got.get(0).userid());
    }

    @Test
    void handleFrameEmitsAuthFailedOnBadSubscribeResp() {
        // 需先记录订阅 reqId:用 connect 前不可得,故本测直接驱动 handleFrame 的订阅判定分支——
        // 通过反射/包私 setter 注入 subscribeReqId(见实现:setSubscribeReqIdForTest)。
        WecomWsClient c = client();
        c.setSubscribeReqIdForTest("S");
        List<String> status = new ArrayList<>();
        c.handleFrame("{\"headers\":{\"req_id\":\"S\"},\"errcode\":40001,\"errmsg\":\"bad\"}", m -> {}, status::add);
        assertTrue(status.contains("auth-failed"), "订阅失败应打 auth-failed");
    }

    @Test
    void handleFrameEmitsSubscribedOnOkResp() {
        WecomWsClient c = client();
        c.setSubscribeReqIdForTest("S");
        List<String> status = new ArrayList<>();
        c.handleFrame("{\"headers\":{\"req_id\":\"S\"},\"errcode\":0}", m -> {}, status::add);
        assertTrue(status.contains("subscribed"));
    }

    @Test
    void handleFrameIgnoresUnrelated() {
        List<WecomFrames.Inbound> got = new ArrayList<>();
        List<String> status = new ArrayList<>();
        client().handleFrame("{\"cmd\":\"ping\",\"headers\":{\"req_id\":\"x\"}}", got::add, status::add);
        assertTrue(got.isEmpty() && status.isEmpty());
    }

    @Test
    void backoffMonotonicCapped() {
        assertTrue(WecomWsClient.backoffSeconds(0) >= 1);
        assertTrue(WecomWsClient.backoffSeconds(99) <= 60);
        assertTrue(WecomWsClient.backoffSeconds(3) >= WecomWsClient.backoffSeconds(0));
    }
}
