package com.lyhn.wraith.browser;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.time.Duration;

public class BrowserConnectivityCheck {
    private final OkHttpClient client;

    public BrowserConnectivityCheck() {
        this(new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(2))
                .callTimeout(Duration.ofSeconds(2))
                .build());
    }

    BrowserConnectivityCheck(OkHttpClient client) {
        this.client = client;
    }

    public ProbeResult probe(int port) {
        if (port < 1024 || port > 65535) {
            return ProbeResult.failed(Failure.BAD_PORT, "端口必须在 1024-65535 之间");
        }
        String url = "http://127.0.0.1:" + port + "/json/version";
        Request request = new Request.Builder().url(url).get().build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                // 有服务应答但不是旧式 CDP 接口。典型是 Chrome 144+：端口由
                // chrome://inspect 的「Allow remote debugging」开关打开，不提供 /json/*。
                return ProbeResult.failed(Failure.HTTP_ERROR, "HTTP " + response.code());
            }
            return ProbeResult.ok("http://127.0.0.1:" + port);
        } catch (Exception e) {
            // 连不上：端口压根没监听（或被防火墙挡）。
            return ProbeResult.failed(Failure.UNREACHABLE, e.getMessage());
        }
    }

    /**
     * 失败原因。区分这两者很关键：HTTP_ERROR 说明**端口是通的**，只是协议对不上，
     * 此时叫用户「先用调试端口启动 Chrome」纯属误导。
     */
    public enum Failure { NONE, BAD_PORT, HTTP_ERROR, UNREACHABLE }

    public record ProbeResult(boolean ok, String browserUrl, String message, Failure failure) {
        static ProbeResult ok(String browserUrl) {
            return new ProbeResult(true, browserUrl, "ok", Failure.NONE);
        }

        static ProbeResult failed(Failure failure, String message) {
            return new ProbeResult(false, null, message == null ? "连接失败" : message, failure);
        }
    }
}
