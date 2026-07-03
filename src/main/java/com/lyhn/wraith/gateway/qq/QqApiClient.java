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
    private final ObjectMapper M = new ObjectMapper();
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
            var node = M.readTree(r.body().string());
            token = node.path("access_token").asText();
            long ttl = node.path("expires_in").asLong(7200);
            expiresAtMs = System.currentTimeMillis() + ttl * 1000;
            if (token == null || token.isEmpty()) throw new IOException("no access_token");
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
