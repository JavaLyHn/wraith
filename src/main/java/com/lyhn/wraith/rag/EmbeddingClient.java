package com.lyhn.wraith.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Embedding 客户端，支持 Ollama 本地模型和 OpenAI 兼容的远程 API
 */
public class EmbeddingClient {
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build();

    private final String provider;
    private final String model;
    private final String baseUrl;
    private final String apiKey;

    public EmbeddingClient() {
        this.provider = getEnv("EMBEDDING_PROVIDER", "ollama");
        this.model = getEnv("EMBEDDING_MODEL", "nomic-embed-text:latest");
        this.baseUrl = getEnv("EMBEDDING_BASE_URL", inferDefaultUrl(provider));
        this.apiKey = getEnv("EMBEDDING_API_KEY", "");
    }

    public EmbeddingClient(String provider, String model, String baseUrl, String apiKey) {
        this.provider = provider;
        this.model = model;
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    /**
     * 按 ~/.wraith/config.json 的「Embedding 后端」构造;没配过则回落到 env/Ollama。
     *
     * <p>所有默认入口（{@link CodeRetriever#CodeRetriever(String)}、{@link CodeIndex#CodeIndex()}、
     * app-server 的 rag.* RPC）都必须走这里。此前只有 app-server 读了配置，agent 的 search_code
     * 与 REPL 的 /index /search 走的是 env-only 的 {@code new EmbeddingClient()} —— 于是在面板里
     * 配好云端后端、索引也建成了，agent 一检索却去连本机 11434 报 Connection refused。
     */
    public static EmbeddingClient fromConfigOrEnv() {
        return fromConfig(com.lyhn.wraith.config.WraithConfig.load().getEmbedding());
    }

    /**
     * 由配置对象构造(纯函数,便于测试)。整节缺失或四个字段全空时回落到 env/Ollama —— 桌面端
     * 从未保存过配置时 config.json 里就是个空的 {@code "embedding": {}}，那不该覆盖 EMBEDDING_* 环境变量。
     */
    public static EmbeddingClient fromConfig(com.lyhn.wraith.config.WraithConfig.EmbeddingConfig e) {
        if (e == null || (isBlank(e.getProvider()) && isBlank(e.getModel())
                && isBlank(e.getBaseUrl()) && isBlank(e.getApiKey()))) {
            return new EmbeddingClient();
        }
        return of(e.getProvider(), e.getModel(), e.getBaseUrl(), e.getApiKey());
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * 由(可能不全的)配置构造:空字段按 provider 填默认。
     * provider 空 → ollama;model/baseUrl 空 → 按 provider 默认。供桌面 embedding 配置使用。
     */
    public static EmbeddingClient of(String provider, String model, String baseUrl, String apiKey) {
        String p = (provider == null || provider.isBlank()) ? "ollama" : provider.trim().toLowerCase();
        String m = (model == null || model.isBlank()) ? defaultModel(p) : model.trim();
        String url = (baseUrl == null || baseUrl.isBlank()) ? inferDefaultUrl(p) : baseUrl.trim();
        return new EmbeddingClient(p, m, url, apiKey == null ? "" : apiKey);
    }

    private static String defaultModel(String provider) {
        return switch (provider) {
            case "zhipu", "glm" -> "embedding-2";
            case "openai" -> "text-embedding-3-small";
            default -> "nomic-embed-text:latest";
        };
    }

    // 安全截断长度（中文密集文本 2000 字符 ≈ 4000~6000 token，适配 8192 上下文模型）
    private static final int MAX_INPUT_CHARS = 2000;

    /**
     * 获取文本的向量表示
     */
    public float[] embed(String text) throws IOException {
        if (text == null || text.isEmpty()) {
            return new float[0];
        }

        // 截断过长文本，防止 API 报错
        String input = text.length() > MAX_INPUT_CHARS
                ? text.substring(0, MAX_INPUT_CHARS)
                : text;

        return switch (provider.toLowerCase()) {
            case "ollama" -> embedOllama(input);
            case "openai", "zhipu", "glm" -> embedOpenAICompatible(input);
            default -> embedOllama(input);
        };
    }

    private float[] embedOllama(String text) throws IOException {
        String url = baseUrl + "/api/embeddings";

        ObjectNode requestBody = mapper.createObjectNode();
        requestBody.put("model", model);
        requestBody.put("prompt", text);

        String responseBody = postJson(url, requestBody.toString(), false);
        JsonNode root = mapper.readTree(responseBody);
        JsonNode embeddingNode = root.path("embedding");

        if (!embeddingNode.isArray()) {
            throw new IOException("Ollama 返回的 embedding 格式不正确: " + responseBody);
        }

        float[] embedding = new float[embeddingNode.size()];
        for (int i = 0; i < embeddingNode.size(); i++) {
            embedding[i] = (float) embeddingNode.get(i).asDouble();
        }
        return embedding;
    }

    private float[] embedOpenAICompatible(String text) throws IOException {
        String url = baseUrl + "/embeddings";

        ObjectNode requestBody = mapper.createObjectNode();
        requestBody.put("model", model);
        requestBody.put("input", text);

        String responseBody = postJson(url, requestBody.toString(), true);
        JsonNode root = mapper.readTree(responseBody);
        JsonNode data = root.path("data");

        if (!data.isArray() || data.isEmpty()) {
            throw new IOException("API 返回的 embedding 格式不正确: " + responseBody);
        }

        JsonNode embeddingNode = data.get(0).path("embedding");
        float[] embedding = new float[embeddingNode.size()];
        for (int i = 0; i < embeddingNode.size(); i++) {
            embedding[i] = (float) embeddingNode.get(i).asDouble();
        }
        return embedding;
    }

    /**
     * 限流/服务端抖动的重试次数(含首次)。整库索引有上千次调用,单次 429 不该让一个代码块永久缺席。
     *
     * <p>**每次调用都重读属性**,不做 static final 缓存 —— 缓存会在类初始化那一刻定死,
     * 之后再设 {@code -Dwraith.embed.retries} 就是无效操作(取决于类加载顺序,测试里最难查的一类假绿)。
     */
    private static int maxAttempts() {
        return Math.max(1, Integer.getInteger("wraith.embed.retries", 4));
    }

    private static final long BASE_BACKOFF_MS = 500;
    private static final long MAX_BACKOFF_MS = 8_000;

    /** 服务端明确要求稍后再来(429/5xx)才重试,带上 Retry-After。 */
    private static class ThrottledException extends IOException {
        final long retryAfterMs;
        ThrottledException(String message, long retryAfterMs) {
            super(message);
            this.retryAfterMs = retryAfterMs;
        }
    }

    /**
     * 只对 429 与 5xx 退避重试。
     *
     * <p>刻意**不**重试 4xx(401 key 错、400 模型名错):整库索引有上千个代码块,把一个必然失败的
     * 配置错误每块重试 4 次只会把「立刻报错」变成「慢 4 倍后报错」。
     * 连接层的瞬断由 OkHttp 自己的 retryOnConnectionFailure(默认开)兜,这里不重复。
     */
    private String postJson(String url, String jsonBody, boolean useAuth) throws IOException {
        int attempts = maxAttempts();
        ThrottledException last = null;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                return postOnce(url, jsonBody, useAuth);
            } catch (ThrottledException e) {
                last = e;
                if (attempt == attempts) break;
                try {
                    Thread.sleep(backoffMillis(attempt, e.retryAfterMs));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Embedding 重试被中断: " + e.getMessage(), e);
                }
            }
        }
        throw new IOException("Embedding API 重试 " + attempts + " 次仍失败: " + last.getMessage(), last);
    }

    /** 指数退避 + 抖动;服务端给了 Retry-After 就听它的。抖动避免并发线程齐步重试再次撞墙。 */
    private static long backoffMillis(int attempt, long retryAfterMs) {
        if (retryAfterMs > 0) {
            return Math.min(retryAfterMs, MAX_BACKOFF_MS);
        }
        long exp = Math.min(BASE_BACKOFF_MS << (attempt - 1), MAX_BACKOFF_MS);
        return exp + (long) (Math.random() * BASE_BACKOFF_MS);
    }

    private String postOnce(String url, String jsonBody, boolean useAuth) throws IOException {
        RequestBody body = RequestBody.create(jsonBody, MediaType.parse("application/json"));
        Request.Builder builder = new Request.Builder()
                .url(url)
                .header("Content-Type", "application/json")
                .post(body);

        if (useAuth && apiKey != null && !apiKey.isEmpty()) {
            builder.header("Authorization", "Bearer " + apiKey);
        }

        try (Response response = HTTP_CLIENT.newCall(builder.build()).execute()) {
            ResponseBody responseBody = response.body();
            if (!response.isSuccessful()) {
                String error = responseBody != null ? responseBody.string() : "无响应";
                String message = "Embedding API 请求失败 [" + response.code() + "]: " + error;
                if (response.code() == 429 || response.code() >= 500) {
                    throw new ThrottledException(message, retryAfterMillis(response));
                }
                throw new IOException(message);
            }
            if (responseBody == null) {
                throw new IOException("Embedding API 返回空响应体");
            }
            return responseBody.string();
        }
    }

    /** Retry-After 只认秒数形式(HTTP-date 形式各家 embedding 服务基本不用);解析不出就返回 0 走指数退避。 */
    private static long retryAfterMillis(Response response) {
        String header = response.header("Retry-After");
        if (header == null || header.isBlank()) return 0;
        try {
            return Math.max(0, (long) (Double.parseDouble(header.trim()) * 1000));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String inferDefaultUrl(String provider) {
        return switch (provider.toLowerCase()) {
            case "ollama" -> "http://localhost:11434";
            case "zhipu", "glm" -> "https://open.bigmodel.cn/api/paas/v4";
            case "openai" -> "https://api.openai.com/v1";
            default -> "http://localhost:11434";
        };
    }

    private static String getEnv(String key, String defaultValue) {
        String value = System.getenv(key);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        value = System.getProperty(key);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        return defaultValue;
    }

    public String getProvider() {
        return provider;
    }

    /** 后端地址。诊断用（{@link EmbeddingErrorHint} 要靠它区分本机与远端）。 */
    public String getBaseUrl() {
        return baseUrl;
    }

    public String getModel() {
        return model;
    }
}
