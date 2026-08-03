package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.config.ProviderResolver;
import com.lyhn.wraith.config.WraithConfig;
import java.util.*;

/** Pure functions for model.list response construction — no LLM calls, no I/O. */
public final class ModelCatalog {

    private ModelCatalog() {}

    /**
     * Build the providers list from config.
     *
     * <p>报 {@code config.getProviders().keySet()} ∪ {@code ProviderResolver.candidates}
     * （去重，config 优先）。<b>此前是恒含 6 条硬编码空壳</b>
     * （{@code KNOWN_PROVIDERS} ∪ config），而桌面每个消费者都按 {@code hasKey} 过滤
     * （{@code ProvidersPanel:30} doneInstances、{@code :90} restCatalog、
     * {@code modelSwitcher:9} configuredProviders）——那些空壳在 UI 里看不见，
     * 纯属每次 {@code model.list} 的死载荷。
     *
     * <p>每条含 name/model/hasKey/baseUrl/protocol/label。
     * 红线：NEVER includes apiKey value（只报 hasKey）；baseUrl/protocol/label 非密钥，
     * 回报用于编辑回填与多实例显示。
     */
    public static List<Map<String, Object>> providers(WraithConfig config) {
        return providers(config, ProviderResolver.candidates(config));
    }

    /**
     * 同上，但候选表由调用方给出。
     *
     * <p>存在的唯一理由是<b>测试确定性</b>：{@code ProviderResolver.candidates(config)} 会扫
     * 真实环境变量，若测试走 public 入口，「零配置应报空表」这类断言就会在设了
     * {@code ANTHROPIC_API_KEY} 的开发机上失败、在干净 CI 上通过。
     */
    static List<Map<String, Object>> providers(WraithConfig config, List<String> discovered) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(config.getProviders().keySet());
        if (discovered != null) {
            ids.addAll(discovered);
        }
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
        return result(config, currentProvider, currentModel, fallback,
                ProviderResolver.candidates(config));
    }

    /** 同上，候选表由调用方给出（理由同 {@link #providers(WraithConfig, List)}）。 */
    static Map<String, Object> result(WraithConfig config,
                                      String currentProvider, String currentModel,
                                      boolean fallback, List<String> candidates) {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("current", Map.of("provider", currentProvider, "model", currentModel));
        // 报**有效**默认而非 config 里的死字段:老 config.json 里落盘的 "glm" 常常没 key,
        // 照原样回报会让 ProvidersPanel:101 的 `defaultId === p.name` 匹配不上任何行 ——
        // 用户看到一个「默认」标都没有。空串而非 null,桌面侧直接读不必判空。
        res.put("default", candidates == null || candidates.isEmpty() ? "" : candidates.get(0));
        res.put("providers", providers(config, candidates));
        if (fallback) res.put("modelFallback", true);
        return res;
    }
}
