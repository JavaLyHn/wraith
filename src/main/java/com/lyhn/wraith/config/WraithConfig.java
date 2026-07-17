package com.lyhn.wraith.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public class WraithConfig {

    private static final Path CONFIG_DIR = Path.of(System.getProperty("user.home"), ".wraith");
    private static final Path CONFIG_FILE = CONFIG_DIR.resolve("config.json");
    private static final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    private String defaultProvider = "glm";
    private Map<String, ProviderConfig> providers = new LinkedHashMap<>();
    private GatewayConfig gateway;
    private SttConfig stt;
    private EmbeddingConfig embedding;
    private java.util.List<PricingEntry> pricing = new java.util.ArrayList<>();

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ProviderConfig {
        private String apiKey;
        private String baseUrl;
        private String model;
        private String loraId;
        private double temperature = 0.7;  // 默认温度
        private int maxTokens = 8192;      // 默认最大 token 数
        private String protocol;           // "openai" | "anthropic"; null=按缺省(openai)
        private String label;              // 用户自定义显示名(非密钥;多实例区分用);可空

        public ProviderConfig() {}

        public ProviderConfig(String apiKey, String baseUrl, String model) {
            this.apiKey = apiKey;
            this.baseUrl = baseUrl;
            this.model = model;
        }

        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public String getLoraId() { return loraId; }
        public void setLoraId(String loraId) { this.loraId = loraId; }
        public double getTemperature() { return temperature; }
        public void setTemperature(double temperature) { this.temperature = temperature; }
        public int getMaxTokens() { return maxTokens; }
        public void setMaxTokens(int maxTokens) { this.maxTokens = maxTokens; }
        public String getProtocol() { return protocol; }
        public void setProtocol(String protocol) { this.protocol = protocol; }
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GatewayConfig {
        private GatewayQqConfig qq;
        private GatewayFeishuConfig feishu;
        private GatewayWecomConfig wecom;
        public GatewayQqConfig getQq() { return qq; }
        public void setQq(GatewayQqConfig qq) { this.qq = qq; }
        public GatewayFeishuConfig getFeishu() { return feishu; }
        public void setFeishu(GatewayFeishuConfig feishu) { this.feishu = feishu; }
        public GatewayWecomConfig getWecom() { return wecom; }
        public void setWecom(GatewayWecomConfig wecom) { this.wecom = wecom; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GatewayQqConfig {
        private String appId, clientSecret, ownerOpenid, workspace;
        public String getAppId() { return appId; }               public void setAppId(String v){ appId=v; }
        public String getClientSecret() { return clientSecret; } public void setClientSecret(String v){ clientSecret=v; }
        public String getOwnerOpenid() { return ownerOpenid; }   public void setOwnerOpenid(String v){ ownerOpenid=v; }
        public String getWorkspace() { return workspace; }       public void setWorkspace(String v){ workspace=v; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GatewayFeishuConfig {
        private String appId;
        private String appSecret;
        private String ownerOpenid;
        private String region;      // "feishu"(默认)| "lark"
        private String workspace;
        public String getAppId() { return appId; }               public void setAppId(String v){ appId=v; }
        public String getAppSecret() { return appSecret; }        public void setAppSecret(String v){ appSecret=v; }
        public String getOwnerOpenid() { return ownerOpenid; }    public void setOwnerOpenid(String v){ ownerOpenid=v; }
        public String getRegion() { return region; }             public void setRegion(String v){ region=v; }
        public String getWorkspace() { return workspace; }       public void setWorkspace(String v){ workspace=v; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GatewayWecomConfig {
        private String botId;
        private String secret;
        private String ownerUserid;
        private String workspace;
        public String getBotId() { return botId; }               public void setBotId(String v){ botId=v; }
        public String getSecret() { return secret; }             public void setSecret(String v){ secret=v; }
        public String getOwnerUserid() { return ownerUserid; }   public void setOwnerUserid(String v){ ownerUserid=v; }
        public String getWorkspace() { return workspace; }       public void setWorkspace(String v){ workspace=v; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SttConfig {
        private String providerId;   // 借用哪个 providers 条目的 key/baseUrl
        private String model;
        public String getProviderId() { return providerId; }
        public void setProviderId(String v) { this.providerId = v; }
        public String getModel() { return model; }
        public void setModel(String v) { this.model = v; }
    }

    /** RAG 用的 embedding 后端配置。缺省时 EmbeddingClient 回落到 env/Ollama。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class EmbeddingConfig {
        private String provider;   // ollama | openai | zhipu | glm
        private String model;
        private String baseUrl;
        private String apiKey;     // 仅本地存储,绝不回包/日志
        public String getProvider() { return provider; }
        public void setProvider(String v) { this.provider = v; }
        public String getModel() { return model; }
        public void setModel(String v) { this.model = v; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String v) { this.baseUrl = v; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String v) { this.apiKey = v; }
    }

    /** 模型计价条目(用户自配;官方牌价≠实付价,换算率由掌握合同的人提供)。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PricingEntry {
        private String modelPrefix;
        private double cacheHitPerM;
        private double cacheMissPerM;
        private double outputPerM;
        private String currency = "CNY";
        public String getModelPrefix() { return modelPrefix; }
        public void setModelPrefix(String v) { this.modelPrefix = v; }
        public double getCacheHitPerM() { return cacheHitPerM; }
        public void setCacheHitPerM(double v) { this.cacheHitPerM = v; }
        public double getCacheMissPerM() { return cacheMissPerM; }
        public void setCacheMissPerM(double v) { this.cacheMissPerM = v; }
        public double getOutputPerM() { return outputPerM; }
        public void setOutputPerM(double v) { this.outputPerM = v; }
        public String getCurrency() { return currency; }
        public void setCurrency(String v) { this.currency = (v == null || v.isBlank()) ? "CNY" : v; }
    }

    public String getDefaultProvider() { return defaultProvider; }
    public void setDefaultProvider(String defaultProvider) { this.defaultProvider = defaultProvider; }
    public Map<String, ProviderConfig> getProviders() { return providers; }
    public void setProviders(Map<String, ProviderConfig> providers) { this.providers = providers; }
    public GatewayConfig getGateway() { return gateway; }
    public void setGateway(GatewayConfig gateway) { this.gateway = gateway; }
    public SttConfig getStt() { return stt; }
    public void setStt(SttConfig stt) { this.stt = stt; }
    public EmbeddingConfig getEmbedding() { return embedding; }
    public void setEmbedding(EmbeddingConfig embedding) { this.embedding = embedding; }
    public java.util.List<PricingEntry> getPricing() { return pricing; }
    public void setPricing(java.util.List<PricingEntry> pricing) {
        this.pricing = pricing == null ? new java.util.ArrayList<>() : pricing;
    }

    /** STT 借用的 provider id;缺省 siliconflow。 */
    public String getSttProviderId() {
        return (stt != null && stt.getProviderId() != null && !stt.getProviderId().isBlank())
            ? stt.getProviderId().trim() : "siliconflow";
    }
    /** STT 模型;缺省 SenseVoiceSmall。 */
    public String getSttModel() {
        return (stt != null && stt.getModel() != null && !stt.getModel().isBlank())
            ? stt.getModel().trim() : "FunAudioLLM/SenseVoiceSmall";
    }

    public String getApiKey(String provider) {
        ProviderConfig providerConfig = providers.get(provider);
        if (providerConfig != null && providerConfig.getApiKey() != null && !providerConfig.getApiKey().isBlank()) {
            return providerConfig.getApiKey();
        }
        return loadApiKeyFromEnv(provider);
    }

    public String getModel(String provider) {
        ProviderConfig providerConfig = providers.get(provider);
        if (providerConfig != null && providerConfig.getModel() != null && !providerConfig.getModel().isBlank()) {
            return providerConfig.getModel();
        }
        return loadModelFromEnv(provider);
    }

    public String getBaseUrl(String provider) {
        ProviderConfig providerConfig = providers.get(provider);
        if (providerConfig != null && providerConfig.getBaseUrl() != null && !providerConfig.getBaseUrl().isBlank()) {
            return providerConfig.getBaseUrl();
        }
        return loadBaseUrlFromEnv(provider);
    }

    public String getLoraId(String provider) {
        ProviderConfig providerConfig = providers.get(provider);
        if (providerConfig != null && providerConfig.getLoraId() != null && !providerConfig.getLoraId().isBlank()) {
            return providerConfig.getLoraId();
        }
        return loadLoraIdFromEnv(provider);
    }

    /** provider 的协议:config 有则用,否则缺省 "openai"。 */
    public String getProtocol(String provider) {
        ProviderConfig pc = providers.get(provider);
        if (pc != null && pc.getProtocol() != null && !pc.getProtocol().isBlank())
            return pc.getProtocol();
        return "openai";
    }

    public static WraithConfig load() {
        if (Files.exists(CONFIG_FILE)) {
            try {
                return mapper.readValue(CONFIG_FILE.toFile(), WraithConfig.class);
            } catch (IOException e) {
                System.err.println("⚠️ 配置文件读取失败，使用默认配置: " + e.getMessage());
            }
        }
        return new WraithConfig();
    }

    public void save() {
        try {
            Files.createDirectories(CONFIG_DIR);
            mapper.writeValue(CONFIG_FILE.toFile(), this);
        } catch (IOException e) {
            System.err.println("⚠️ 配置保存失败: " + e.getMessage());
        }
    }

    private static String loadModelFromEnv(String provider) {
        String envKey = switch (provider.toLowerCase()) {
            case "glm" -> "GLM_MODEL";
            case "deepseek" -> "DEEPSEEK_MODEL";
            case "kimi" -> "KIMI_MODEL";
            case "freellmapi" -> "FREELLMAPI_MODEL";
            case "xfyun" -> "XFYUN_MAAS_MODEL";
            default -> provider.toUpperCase() + "_MODEL";
        };

        String envValue = System.getenv(envKey);
        if (envValue != null && !envValue.isBlank()) {
            return envValue.trim();
        }

        String dotEnvValue = readFromDotEnv(envKey);
        if (dotEnvValue != null && !dotEnvValue.isBlank()) {
            return dotEnvValue.trim();
        }

        if ("kimi".equalsIgnoreCase(provider)) {
            String moonshotValue = System.getenv("MOONSHOT_MODEL");
            if (moonshotValue != null && !moonshotValue.isBlank()) {
                return moonshotValue.trim();
            }
            String moonshotDotEnvValue = readFromDotEnv("MOONSHOT_MODEL");
            if (moonshotDotEnvValue != null && !moonshotDotEnvValue.isBlank()) {
                return moonshotDotEnvValue.trim();
            }
        }

        if ("xfyun".equalsIgnoreCase(provider)) {
            String xfyunValue = System.getenv("XFYUN_MODEL");
            if (xfyunValue != null && !xfyunValue.isBlank()) {
                return xfyunValue.trim();
            }
            String xfyunDotEnvValue = readFromDotEnv("XFYUN_MODEL");
            if (xfyunDotEnvValue != null && !xfyunDotEnvValue.isBlank()) {
                return xfyunDotEnvValue.trim();
            }
        }

        return null;
    }

    private static String loadApiKeyFromEnv(String provider) {
        String envKey = switch (provider.toLowerCase()) {
            case "glm" -> "GLM_API_KEY";
            case "deepseek" -> "DEEPSEEK_API_KEY";
            case "step" -> "STEP_API_KEY";
            case "kimi" -> "KIMI_API_KEY";
            case "freellmapi" -> "FREELLMAPI_API_KEY";
            case "xfyun" -> "XFYUN_MAAS_API_KEY";
            default -> provider.toUpperCase() + "_API_KEY";
        };

        String envValue = System.getenv(envKey);
        if (envValue != null && !envValue.isBlank()) {
            return envValue.trim();
        }

        String dotEnvValue = readFromDotEnv(envKey);
        if (dotEnvValue != null && !dotEnvValue.isBlank()) {
            return dotEnvValue.trim();
        }

        if ("kimi".equalsIgnoreCase(provider)) {
            String moonshotValue = System.getenv("MOONSHOT_API_KEY");
            if (moonshotValue != null && !moonshotValue.isBlank()) {
                return moonshotValue.trim();
            }
            String moonshotDotEnvValue = readFromDotEnv("MOONSHOT_API_KEY");
            if (moonshotDotEnvValue != null && !moonshotDotEnvValue.isBlank()) {
                return moonshotDotEnvValue.trim();
            }
        }

        if ("xfyun".equalsIgnoreCase(provider)) {
            String xfyunValue = System.getenv("XFYUN_API_KEY");
            if (xfyunValue != null && !xfyunValue.isBlank()) {
                return xfyunValue.trim();
            }
            String xfyunDotEnvValue = readFromDotEnv("XFYUN_API_KEY");
            if (xfyunDotEnvValue != null && !xfyunDotEnvValue.isBlank()) {
                return xfyunDotEnvValue.trim();
            }
        }

        return null;
    }

    private static String loadBaseUrlFromEnv(String provider) {
        String envKey = switch (provider.toLowerCase()) {
            case "step" -> "STEP_BASE_URL";
            case "kimi" -> "KIMI_BASE_URL";
            case "freellmapi" -> "FREELLMAPI_BASE_URL";
            case "xfyun" -> "XFYUN_MAAS_BASE_URL";
            default -> provider.toUpperCase() + "_BASE_URL";
        };

        String envValue = System.getenv(envKey);
        if (envValue != null && !envValue.isBlank()) {
            return envValue.trim();
        }

        String dotEnvValue = readFromDotEnv(envKey);
        if (dotEnvValue != null && !dotEnvValue.isBlank()) {
            return dotEnvValue.trim();
        }

        if ("kimi".equalsIgnoreCase(provider)) {
            String moonshotValue = System.getenv("MOONSHOT_BASE_URL");
            if (moonshotValue != null && !moonshotValue.isBlank()) {
                return moonshotValue.trim();
            }
            String moonshotDotEnvValue = readFromDotEnv("MOONSHOT_BASE_URL");
            if (moonshotDotEnvValue != null && !moonshotDotEnvValue.isBlank()) {
                return moonshotDotEnvValue.trim();
            }
        }

        if ("xfyun".equalsIgnoreCase(provider)) {
            String xfyunValue = System.getenv("XFYUN_BASE_URL");
            if (xfyunValue != null && !xfyunValue.isBlank()) {
                return xfyunValue.trim();
            }
            String xfyunDotEnvValue = readFromDotEnv("XFYUN_BASE_URL");
            if (xfyunDotEnvValue != null && !xfyunDotEnvValue.isBlank()) {
                return xfyunDotEnvValue.trim();
            }
        }

        return null;
    }

    private static String loadLoraIdFromEnv(String provider) {
        if (!"xfyun".equalsIgnoreCase(provider)) {
            return null;
        }

        String envValue = System.getenv("XFYUN_MAAS_LORA_ID");
        if (envValue != null && !envValue.isBlank()) {
            return envValue.trim();
        }

        String dotEnvValue = readFromDotEnv("XFYUN_MAAS_LORA_ID");
        if (dotEnvValue != null && !dotEnvValue.isBlank()) {
            return dotEnvValue.trim();
        }

        String xfyunValue = System.getenv("XFYUN_LORA_ID");
        if (xfyunValue != null && !xfyunValue.isBlank()) {
            return xfyunValue.trim();
        }

        String xfyunDotEnvValue = readFromDotEnv("XFYUN_LORA_ID");
        if (xfyunDotEnvValue != null && !xfyunDotEnvValue.isBlank()) {
            return xfyunDotEnvValue.trim();
        }
        return null;
    }

    private static String readFromDotEnv(String key) {
        File[] envFiles = { new File(".env"), new File(System.getProperty("user.home"), ".env") };
        for (File envFile : envFiles) {
            if (!envFile.exists()) continue;
            try (BufferedReader reader = new BufferedReader(new FileReader(envFile))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    if (line.startsWith(key + "=")) {
                        return line.substring((key + "=").length()).trim();
                    }
                }
            } catch (IOException ignored) {}
        }
        return null;
    }
}
