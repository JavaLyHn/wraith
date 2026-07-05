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
     * NEVER includes apiKey or baseUrl values — only hasKey boolean.
     */
    public static List<Map<String, Object>> providers(WraithConfig config) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(java.util.Arrays.asList(KNOWN_PROVIDERS));
        ids.addAll(config.getProviders().keySet());
        List<Map<String, Object>> list = new ArrayList<>();
        for (String p : ids) {
            String apiKey = config.getApiKey(p);
            boolean hasKey = apiKey != null && !apiKey.isBlank();
            String modelName = config.getModel(p);
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", p);
            entry.put("model", modelName != null ? modelName : "");
            entry.put("hasKey", hasKey);
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
