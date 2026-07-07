package com.lyhn.wraith.stt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 云端 STT 客户端:multipart POST <baseUrl>/audio/transcriptions,解析 {text}。 */
public final class SttClient {

    private static final ObjectMapper M = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15)).build();

    /** 取响应 JSON 的 text 字段(trim);缺字段/空/畸形 → IllegalStateException。 */
    public static String parseTranscription(String json) {
        JsonNode n;
        try {
            n = M.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException("转写响应解析失败", e);
        }
        JsonNode t = n == null ? null : n.get("text");
        if (t == null || t.isNull()) throw new IllegalStateException("转写响应无 text 字段");
        String s = t.asText().trim();
        if (s.isEmpty()) throw new IllegalStateException("转写结果为空");
        return s;
    }

    /** 录音字节 → 转写文本。 */
    public String transcribe(byte[] audio, String mime, String apiKey, String baseUrl, String model)
            throws Exception {
        String boundary = "----wraithstt" + Long.toHexString(System.nanoTime());
        String fileName = mime != null && mime.contains("wav") ? "audio.wav"
                        : mime != null && mime.contains("mp3") ? "audio.mp3" : "audio.webm";
        String ct = (mime == null || mime.isBlank()) ? "application/octet-stream" : mime;

        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Disposition: form-data; name=\"model\"\r\n\r\n" + model + "\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Type: " + ct + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(audio);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        String url = baseUrl.replaceAll("/+$", "") + "/audio/transcriptions";
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() / 100 != 2) {
            throw new IllegalStateException("STT 上游 HTTP " + resp.statusCode());
        }
        return parseTranscription(resp.body());
    }
}
