package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.config.WraithConfig;
import java.util.*;

/** Pure functions for model.list response construction — no LLM calls, no I/O. */
public final class ModelCatalog {

    private ModelCatalog() {}

    static final String[] KNOWN_PROVIDERS = {"glm", "deepseek", "step", "kimi", "freellmapi", "xfyun"};

    /**
     * Build the providers list from config.
     * Reports KNOWN_PROVIDERS ∪ config.getProviders().keySet() (KNOWN first, deduped).
     * 每条含 name/model/hasKey/baseUrl/protocol/label。
     * 红线:NEVER includes apiKey value(只报 hasKey);baseUrl/protocol/label 非密钥,回报用于编辑回填与多实例显示。
     */
    public static List<Map<String, Object>> providers(WraithConfig config) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(java.util.Arrays.asList(KNOWN_PROVIDERS));
        ids.addAll(config.getProviders().keySet());
        List<Map<String, Object>> list = new ArrayList<>();
        for (String p : ids) {
            String apiKey = config.getApiKey(p);
            boolean hasKey = apiKey != null && !apiKey.isBlank();
            String modelName = config.getModel(p);
            String baseUrl = config.getBaseUrl(p);
            WraithConfig.ProviderConfig pc = config.getProviders().get(p);
            String label = pc != null ? pc.getLabel() : null;
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", p);
            entry.put("model", modelName != null ? modelName : "");
            entry.put("hasKey", hasKey);
            entry.put("baseUrl", baseUrl != null ? baseUrl : "");
            entry.put("protocol", config.getProtocol(p));
            entry.put("label", label != null ? label : "");
            list.add(entry);
        }
        return list;
    }

    /**
     * Build the full model.list result map.
     * currentProvider/currentModel are the live client values.
     * fallback=true adds modelFallback:true.
     */
    public static Map<String, Object> result(WraithConfig config,
                                              String currentProvider, String currentModel,
                                              boolean fallback) {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("current", Map.of("provider", currentProvider, "model", currentModel));
        res.put("default", config.getDefaultProvider() != null ? config.getDefaultProvider() : "");
        res.put("providers", providers(config));
        if (fallback) res.put("modelFallback", true);
        return res;
    }
}
