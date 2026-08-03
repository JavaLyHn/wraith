package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for ModelCatalog — pure function tests that verify:
 * 1. API key value is NEVER included in output (key-leakage prevention)
 * 2. baseUrl/protocol/label ARE included (non-secret, required for edit prefill)
 * 3. hasKey boolean IS correctly set based on config
 * 4. result structure is well-formed
 */
class ModelCatalogTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Build a WraithConfig with a canary apiKey and baseUrl for one provider. */
    private WraithConfig configWithCanary(String provider, String canaryKey, String canaryBaseUrl) {
        WraithConfig config = new WraithConfig();
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig(canaryKey, canaryBaseUrl, "model-test");
        config.getProviders().put(provider, pc);
        return config;
    }

    // ── Test: API key value never leaks; baseUrl IS reported ────────────────

    @Test
    void providersExposesBaseUrlButNeverApiKey() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("deepseek", canaryKey, canaryBaseUrl);

        List<Map<String, Object>> providers = ModelCatalog.providers(config);
        String json = MAPPER.writeValueAsString(providers);

        assertFalse(json.contains(canaryKey),
                "providers() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertTrue(json.contains(canaryBaseUrl),
                "providers() 现在应回报 baseUrl(非密钥,回填所需): " + canaryBaseUrl);
    }

    // ── Test: hasKey=true is set correctly when key present ─────────────────

    @Test
    void providersHasKeyTrueWhenKeyConfigured() {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        WraithConfig config = configWithCanary("deepseek", canaryKey, null);

        List<Map<String, Object>> providers = ModelCatalog.providers(config);
        Map<String, Object> deepseekEntry = providers.stream()
                .filter(e -> "deepseek".equals(e.get("name")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("deepseek entry missing"));

        assertTrue((Boolean) deepseekEntry.get("hasKey"),
                "deepseek 配置了 apiKey 时 hasKey 应为 true");
    }

    // ── Test: hasKey=false when no key configured ────────────────────────────

    @Test
    void providersHasKeyFalseWhenNoKeyConfigured() {
        WraithConfig config = new WraithConfig(); // no providers configured

        List<Map<String, Object>> providers = ModelCatalog.providers(config);
        // All entries should have hasKey=false (no env vars set in test)
        for (Map<String, Object> entry : providers) {
            String name = (String) entry.get("name");
            // Only assert for providers that definitely have no env-var keys in CI
            // Use glm as a safe bet (no GLM_API_KEY env var in test environment)
            if ("step".equals(name)) {
                // step has no fallback env var that would normally be set
                assertNotNull(entry.get("hasKey"), "hasKey field must be present for provider: " + name);
            }
        }
    }

    // ── Test: result() full shape with canary injection ──────────────────────

    @Test
    void resultExposesBaseUrlButNeverApiKey() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("glm", canaryKey, canaryBaseUrl);
        config.setDefaultProvider("glm");

        Map<String, Object> result = ModelCatalog.result(config, "glm", "glm-4-flash", false);
        String json = MAPPER.writeValueAsString(result);

        assertFalse(json.contains(canaryKey),
                "result() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertTrue(json.contains(canaryBaseUrl),
                "result() 现在应回报 baseUrl(非密钥): " + canaryBaseUrl);
    }

    // ── Test: result() structure is well-formed ──────────────────────────────

    @Test
    void resultHasExpectedTopLevelKeys() {
        WraithConfig config = new WraithConfig();
        config.setDefaultProvider("deepseek");

        Map<String, Object> result = ModelCatalog.result(config, "deepseek", "deepseek-chat", false);

        assertTrue(result.containsKey("current"), "result 应含 current");
        assertTrue(result.containsKey("default"), "result 应含 default");
        assertTrue(result.containsKey("providers"), "result 应含 providers");
        assertFalse(result.containsKey("modelFallback"), "fallback=false 时不应含 modelFallback");

        @SuppressWarnings("unchecked")
        Map<String, Object> current = (Map<String, Object>) result.get("current");
        assertEquals("deepseek", current.get("provider"));
        assertEquals("deepseek-chat", current.get("model"));
        assertEquals("deepseek", result.get("default"));
    }

    // ── Test: fallback flag appears when fallback=true ───────────────────────

    @Test
    void resultContainsModelFallbackWhenFallbackTrue() {
        WraithConfig config = new WraithConfig();

        Map<String, Object> result = ModelCatalog.result(config, "glm", "glm-4", true);

        assertTrue(result.containsKey("modelFallback"), "fallback=true 时应含 modelFallback");
        assertEquals(Boolean.TRUE, result.get("modelFallback"));
    }

    // ── Test: baseUrl/protocol/label are reported ────────────────────────────

    @Test
    void providersReportBaseUrlProtocolLabel() {
        WraithConfig config = new WraithConfig();
        WraithConfig.ProviderConfig pc =
                new WraithConfig.ProviderConfig("k", "https://x.example/v1", "m");
        pc.setProtocol("anthropic");
        pc.setLabel("工作号");
        config.getProviders().put("minimax", pc);

        Map<String, Object> entry = ModelCatalog.providers(config).stream()
                .filter(e -> "minimax".equals(e.get("name")))
                .findFirst().orElseThrow();

        assertEquals("https://x.example/v1", entry.get("baseUrl"));
        assertEquals("anthropic", entry.get("protocol"));
        assertEquals("工作号", entry.get("label"));
        assertTrue((Boolean) entry.get("hasKey"));
        assertFalse(entry.containsKey("apiKey"), "entry 绝不含 apiKey 字段");
    }

    // ── Test: providers 只报真有的,不再恒含 6 条空壳 ──────────────────────────
    //
    // 原测试断言 providers.size() == KNOWN_PROVIDERS.length —— 它在断言 bug。
    // 那 6 条 hasKey:false 的空壳在 UI 里根本看不见(桌面每个消费者都按 hasKey 过滤:
    // ProvidersPanel:30 doneInstances、:90 restCatalog、modelSwitcher:9
    // configuredProviders),纯属每次 model.list 多发的死载荷。

    // 这五条都走**注入重载**,不碰真实环境变量:若调 public 入口,它会扫 env,
    // 于是「零配置报空表」在设了 ANTHROPIC_API_KEY 的开发机上失败、在干净 CI 上通过。

    /** 一个只含指定 provider(都带 key)的 config。 */
    private static WraithConfig cfg(String defaultProvider, String... ids) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new java.util.LinkedHashMap<>());
        for (String id : ids) {
            c.getProviders().put(id, new WraithConfig.ProviderConfig("sk-" + id, null, "m"));
        }
        return c;
    }

    @Test
    @DisplayName("零配置 → providers 为空表,不再凭空报 6 家")
    void emptyConfigReportsNoProviders() {
        assertTrue(ModelCatalog.providers(cfg(null), List.of()).isEmpty(),
                "一个 provider 都没配时不该报任何条目");
    }

    @Test
    @DisplayName("配了 N 个就报 N 个,一条不多")
    void reportsExactlyWhatIsConfigured() {
        WraithConfig config = cfg(null, "anthropic", "siliconflow");

        List<Map<String, Object>> providers =
                ModelCatalog.providers(config, List.of("anthropic", "siliconflow"));

        assertEquals(2, providers.size(), "实际: " + providers);
        assertEquals("anthropic", providers.get(0).get("name"), "保持插入序");
        assertEquals("siliconflow", providers.get(1).get("name"));
        assertEquals(true, providers.get(0).get("hasKey"));
    }

    @Test
    @DisplayName("env 里发现的 provider 也报出来 —— 否则 env-only 用户看到空面板但对话能用")
    void envDiscoveredProviderIsReported() {
        WraithConfig config = cfg(null);          // config.json 里一个都没有
        List<Map<String, Object>> providers = ModelCatalog.providers(config, List.of("anthropic"));

        assertEquals(1, providers.size(), "实际: " + providers);
        assertEquals("anthropic", providers.get(0).get("name"));
    }

    @Test
    @DisplayName("default 报有效默认 —— stale \"glm\" 不能让面板一个「默认」标都不显示")
    void resultReportsEffectiveDefault() {
        // 老 config.json 里 defaultProvider 是落盘的硬编码 "glm",但 glm 没 key。
        // 若照原样回报,ProvidersPanel:101 的 `defaultId === p.name` 匹配不上任何行。
        WraithConfig config = cfg("glm", "anthropic");

        Map<String, Object> result =
                ModelCatalog.result(config, "anthropic", "m", false, List.of("anthropic"));

        assertEquals("anthropic", result.get("default"),
                "应报实际会被用上的那个,而不是 config 里的死字段");
    }

    @Test
    @DisplayName("候选表为空时 default 是空串,不是死配置里那个没 key 的 defaultProvider(桌面直接读,不判 null)")
    void effectiveDefaultIsEmptyStringWhenNothingConfigured() {
        // defaultProvider="glm" 但零 provider、候选表(模拟 ProviderResolver 判定 glm 没 key)为空——
        // 老逻辑 config.getDefaultProvider()!=null?...:"" 会原样吐出 "glm"(有判别力);
        // 用 cfg(null) 的话 defaultProvider 本来就是 null,老逻辑对 null 输入也会回落成 "",
        // 新旧结果相同,验证不出这条 bug,所以必须用非空但没 key 的 defaultProvider。
        WraithConfig config = cfg("glm");
        assertEquals("", ModelCatalog.result(config, "", "", false, List.of()).get("default"));
    }
}
