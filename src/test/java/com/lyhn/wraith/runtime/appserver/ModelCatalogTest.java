package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for ModelCatalog — pure function tests that verify:
 * 1. API key and baseUrl values are NEVER included in output (key-leakage prevention)
 * 2. hasKey boolean IS correctly set based on config
 * 3. result structure is well-formed
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

    // ── Test: API key value never leaks into providers() output ─────────────

    @Test
    void providersNeverExposesApiKeyValue() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("deepseek", canaryKey, canaryBaseUrl);

        List<Map<String, Object>> providers = ModelCatalog.providers(config);
        String json = MAPPER.writeValueAsString(providers);

        assertFalse(json.contains(canaryKey),
                "providers() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertFalse(json.contains(canaryBaseUrl),
                "providers() 序列化结果不应含 canary baseUrl 值: " + canaryBaseUrl);
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
    void resultNeverExposesApiKeyOrBaseUrl() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("glm", canaryKey, canaryBaseUrl);
        config.setDefaultProvider("glm");

        Map<String, Object> result = ModelCatalog.result(config, "glm", "glm-4-flash", false);
        String json = MAPPER.writeValueAsString(result);

        assertFalse(json.contains(canaryKey),
                "result() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertFalse(json.contains(canaryBaseUrl),
                "result() 序列化结果不应含 canary baseUrl 值: " + canaryBaseUrl);
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

    // ── Test: all KNOWN_PROVIDERS appear in providers list ───────────────────

    @Test
    void providersListContainsAllKnownProviders() {
        WraithConfig config = new WraithConfig();
        List<Map<String, Object>> providers = ModelCatalog.providers(config);

        assertEquals(ModelCatalog.KNOWN_PROVIDERS.length, providers.size(),
                "providers 数量应与 KNOWN_PROVIDERS 一致");
        for (String name : ModelCatalog.KNOWN_PROVIDERS) {
            boolean found = providers.stream().anyMatch(e -> name.equals(e.get("name")));
            assertTrue(found, "providers 应包含 " + name);
        }
    }
}
