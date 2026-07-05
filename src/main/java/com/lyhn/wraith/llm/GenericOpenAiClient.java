package com.lyhn.wraith.llm;

/** 可配置的 OpenAI-兼容客户端:baseUrl+model+key+providerId 由 config/catalog 提供。
 *  覆盖 openhanako 目录里 defaultApi=openai-completions 的所有 provider。 */
public class GenericOpenAiClient extends AbstractOpenAiCompatibleClient {

    private final String apiKey;
    private final String model;
    private final String apiUrl;      // 完整 /chat/completions
    private final String providerId;

    public GenericOpenAiClient(String apiKey, String model, String baseUrl, String providerId) {
        this.apiKey = apiKey;
        this.model = model != null ? model.trim() : "";
        this.apiUrl = joinChatCompletions(baseUrl);
        this.providerId = providerId != null && !providerId.isBlank() ? providerId : "openai-compatible";
    }

    /** baseUrl(API 根)→ 拼 /chat/completions;去重尾斜杠。若已含 chat/completions 则原样返回。 */
    static String joinChatCompletions(String baseUrl) {
        String b = (baseUrl == null || baseUrl.isBlank()) ? "https://api.openai.com/v1" : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/chat/completions")) return b;
        return b + "/chat/completions";
    }

    @Override protected String getApiUrl() { return apiUrl; }
    @Override protected String getModel()  { return model; }
    @Override protected String getApiKey() { return apiKey; }

    @Override public String getModelName()    { return model; }
    @Override public String getProviderName() { return providerId; }
}
