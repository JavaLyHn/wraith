package com.lyhn.wraith.gateway.bind;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

/**
 * QQ 开放平台「扫码绑定」（openclaw）客户端 + 密文解密。
 *
 * <p>绑定流程（EYE-VERIFY，需真机扫码）：
 * <ol>
 *   <li>{@link #createBindTask(String)} 提交一个由本地生成的 base64 AES key，换回 task_id；</li>
 *   <li>用户在手机 QQ 扫码授权；</li>
 *   <li>{@link #pollBindResult(String)} 轮询直到 status=2(COMPLETED)，拿回 bot_appid /
 *       bot_encrypt_secret(用同一把 key AES-GCM 加密) / user_openid；</li>
 *   <li>{@link #decryptSecret(String, byte[])} 用本地 key 解出明文 clientSecret。</li>
 * </ol>
 *
 * <p>⚠ 解出的 clientSecret / appId / openid 只能写入 {@code ~/.wraith/config.json}，
 * 绝不打印或日志。
 *
 * <p>纯逻辑（单测覆盖）：{@link #decryptSecret}。网络路径（create/poll）与真实 portal
 * 端点/字段名同为 EYE-VERIFY。
 */
public final class Openclaw {

    private static final MediaType JSON = MediaType.get("application/json");
    /** QQ 开放平台 lite 门户（真实端点/协议为 EYE-VERIFY）。 */
    private static final String PORTAL = "https://q.qq.com";

    private final OkHttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Openclaw(OkHttpClient http) {
        this.http = http;
    }

    /**
     * AES/GCM/NoPadding 解密。约定布局：前 12 字节 = IV，其余 = 密文 + 16 字节 GCM tag。
     * {@code GCMParameterSpec(128, iv)}。
     *
     * @param b64Cipher base64(IV || ciphertext+tag)
     * @param aesKey    32 字节 AES key（与 createBindTask 提交的同一把）
     * @return 解密后的明文（UTF-8）
     */
    public static String decryptSecret(String b64Cipher, byte[] aesKey) throws Exception {
        byte[] all = Base64.getDecoder().decode(b64Cipher);
        ByteBuffer bb = ByteBuffer.wrap(all);
        byte[] iv = new byte[12];
        bb.get(iv);
        byte[] rest = new byte[all.length - 12]; // ciphertext + 16B tag
        bb.get(rest);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(rest), StandardCharsets.UTF_8);
    }

    /**
     * 提交本地生成的 base64 AES key，创建绑定任务。
     *
     * @return task_id
     */
    public String createBindTask(String base64Key) throws IOException {
        String body = mapper.writeValueAsString(Map.of("key", base64Key));
        Request req = new Request.Builder()
                .url(PORTAL + "/lite/create_bind_task")
                .post(RequestBody.create(body, JSON))
                .header("Accept", "application/json")
                .build();
        try (Response r = http.newCall(req).execute()) {
            ResponseBody rb = r.body();
            JsonNode d = mapper.readTree(rb == null ? "{}" : rb.string());
            if (d.path("retcode").asInt(-1) != 0) {
                throw new IOException("create_bind_task failed: " + d.path("msg").asText());
            }
            return d.path("data").path("task_id").asText();
        }
    }

    /**
     * 轮询绑定结果。
     *
     * @return {@code [status, bot_appid, bot_encrypt_secret, user_openid]}；
     *         status:1 PENDING / 2 COMPLETED / 3 EXPIRED
     */
    public String[] pollBindResult(String taskId) throws IOException {
        String body = mapper.writeValueAsString(Map.of("task_id", taskId));
        Request req = new Request.Builder()
                .url(PORTAL + "/lite/poll_bind_result")
                .post(RequestBody.create(body, JSON))
                .header("Accept", "application/json")
                .build();
        try (Response r = http.newCall(req).execute()) {
            ResponseBody rb = r.body();
            JsonNode d = mapper.readTree(rb == null ? "{}" : rb.string()).path("data");
            return new String[]{
                    d.path("status").asText("0"),
                    d.path("bot_appid").asText(""),
                    d.path("bot_encrypt_secret").asText(""),
                    d.path("user_openid").asText("")
            };
        }
    }
}
