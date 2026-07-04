package com.lyhn.wraith.gateway.qq;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public final class QqApiClient {
    private static final MediaType JSON = MediaType.get("application/json");
    private final String appId, clientSecret, apiBase, tokenUrl;
    private final OkHttpClient http;
    private static final ObjectMapper M = new ObjectMapper();
    private final AtomicInteger seqCtr = new AtomicInteger(0);
    private volatile String token;
    private volatile long expiresAtMs;

    public QqApiClient(String appId, String clientSecret, String apiBase, String tokenUrl, OkHttpClient http) {
        this.appId = appId; this.clientSecret = clientSecret; this.apiBase = apiBase; this.tokenUrl = tokenUrl; this.http = http;
    }

    public synchronized String ensureToken() throws IOException {   // singleflight via synchronized
        if (token != null && System.currentTimeMillis() < expiresAtMs - 60_000) return token;
        String body = M.writeValueAsString(java.util.Map.of("appId", appId, "clientSecret", clientSecret));
        try (Response r = http.newCall(new Request.Builder().url(tokenUrl)
                .post(RequestBody.create(body, JSON)).header("Accept", "application/json").build()).execute()) {
            okhttp3.ResponseBody rb = r.body();
            if (rb == null) throw new IOException("empty token response");
            var node = M.readTree(rb.string());
            token = node.path("access_token").asText();
            long ttl = node.path("expires_in").asLong(7200);
            expiresAtMs = System.currentTimeMillis() + ttl * 1000;
            if (token.isEmpty()) throw new IOException("no access_token");
            return token;
        }
    }

    public void sendC2C(String openid, String text, String replyToMsgId) throws IOException {
        List<String> parts = QqText.chunk(text, 4000);
        boolean first = true;
        for (String part : parts) {
            var body = new java.util.LinkedHashMap<String, Object>();
            body.put("content", part);
            body.put("msg_type", 0);                              // text
            body.put("msg_seq", QqText.nextMsgSeq(seqCtr));
            if (first && replyToMsgId != null && !replyToMsgId.isEmpty()) body.put("msg_id", replyToMsgId);
            post("/v2/users/" + openid + "/messages", M.writeValueAsString(body));
            first = false;
        }
    }

    /**
     * 发送一条带 inline keyboard 的 C2C 消息（单条，不分片）——用于 HITL 审批按钮。
     *
     * <p>body 与 {@link #sendC2C} 同构，额外塞入解析自 {@code keyboardJson} 的
     * {@code "keyboard"} 字段（{@code QqApproval.keyboardJson(sessionKey)} 产出）。
     *
     * <p>⚠ EYE-VERIFY：QQ keyboard 消息的确切 {@code msg_type} 与 keyboard 对象形状
     * 只能在真 QQ 联调时确认。此处 {@code msg_type=2}（markdown/keyboard 家族）为合理默认，
     * 真机可能需调整。
     *
     * @param keyboardJson {@code {"content":{"rows":[...]}}} 形状的 keyboard 对象 JSON
     */
    public void sendC2CWithKeyboard(String openid, String text, String replyToMsgId, String keyboardJson)
            throws IOException {
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("content", text);
        body.put("msg_type", 2);                                  // keyboard/markdown family (EYE-VERIFY)
        body.put("msg_seq", QqText.nextMsgSeq(seqCtr));
        if (replyToMsgId != null && !replyToMsgId.isEmpty()) body.put("msg_id", replyToMsgId);
        body.put("keyboard", M.readTree(keyboardJson));
        post("/v2/users/" + openid + "/messages", M.writeValueAsString(body));
    }

    public void ackInteraction(String id) throws IOException {
        Request req = new Request.Builder().url(apiBase + "/interactions/" + id)
                .put(RequestBody.create("{\"code\":0}", JSON))
                .header("Authorization", "QQBot " + ensureToken()).header("Accept", "application/json").build();
        try (Response r = http.newCall(req).execute()) { /* best-effort ack */ }
    }

    private void post(String path, String json) throws IOException {
        Request req = new Request.Builder().url(apiBase + path)
                .post(RequestBody.create(json, JSON))
                .header("Authorization", "QQBot " + ensureToken()).header("Accept", "application/json").build();
        try (Response r = http.newCall(req).execute()) {
            if (!r.isSuccessful()) throw new IOException("QQ send failed: HTTP " + r.code());
        }
    }
}
