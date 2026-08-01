package com.lyhn.wraith.llm;

public class FreeLlmApiClient extends AbstractOpenAiCompatibleClient {

    private static final String DEFAULT_BASE_URL = "http://localhost:5173/v1";
    private static final String DEFAULT_MODEL = "auto";

    private final String apiKey;
    private final String model;
    private final String apiUrl;

    public FreeLlmApiClient(String apiKey, String model, String baseUrl) {
        this.apiKey = apiKey;
        this.model = model != null && !model.isBlank() ? model : DEFAULT_MODEL;
        this.apiUrl = toChatCompletionsUrl(baseUrl);
    }

    @Override
    protected String getApiUrl() {
        return apiUrl;
    }

    @Override
    protected String getModel() {
        return model;
    }

    @Override
    protected String getApiKey() {
        return apiKey;
    }

    /**
     * freellmapi 是「一个网关后面挂任意模型」的转发型 provider,常挂思考型模型
     * (deepseek-v4-pro / glm 等)。这类模型在 thinking mode 下要求把上一条 assistant 的
     * reasoning_content 原样回传,否则下一次调用直接 400:
     *   "The `reasoning_content` in the thinking mode must be passed back to the API."
     * 表现为「只要这一轮调过工具就必炸」—— 工具轮才有第二次 LLM 调用。
     *
     * 打开它对非思考型模型无副作用:序列化处只在该条 assistant 消息确实带了
     * reasoningContent 时才写字段,模型没产出就什么也不加。
     */
    @Override
    protected boolean shouldSendReasoningContentInRequestHistory() {
        return true;
    }

    @Override
    public String getModelName() {
        return model;
    }

    @Override
    public String getProviderName() {
        return "freellmapi";
    }

    @Override
    public int maxContextWindow() {
        return 128_000;
    }

    private static String toChatCompletionsUrl(String baseUrl) {
        String normalized = baseUrl != null && !baseUrl.isBlank() ? baseUrl.trim() : DEFAULT_BASE_URL;
        String withoutTrailingSlash = normalized.replaceAll("/+$", "");
        if (withoutTrailingSlash.endsWith("/chat/completions")) {
            return withoutTrailingSlash;
        }
        return withoutTrailingSlash + "/chat/completions";
    }
}
