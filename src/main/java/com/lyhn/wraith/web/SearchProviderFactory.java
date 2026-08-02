package com.lyhn.wraith.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.Locale;

/**
 * 按环境变量 / .env / 系统属性选择 SearchProvider 实现。
 *
 * <p><b>Key 的取值链</b>：环境变量 → 系统属性 → {@code ./.env} → {@code ~/.env}
 * → <b>{@code ~/.wraith/config.json}</b>（最后这一环是后补的）。
 * 补它的原因：桌面「Provider 配置」面板保存到的正是 config.json，而此前这里读不到，
 * 于是「在 GUI 里配好了 GLM，web_search 仍然报未配置」——
 * 与文档里到处写的「CLI 与桌面共享同一份配置」直接冲突。
 * 只有能映射到 provider 的 key（目前是 {@code GLM_API_KEY} → {@code glm}）才查 config；
 * {@code SERPAPI_KEY} / {@code SEARXNG_URL} 在 config.json 里没有对应概念，仍是环境变量专属。
 *
 * 自动选择优先级（未显式 SEARCH_PROVIDER 时）：
 * <ol>
 *   <li>有 {@code GLM_API_KEY} → zhipu（智谱 Web Search，与 GLM 推理共用 Key，国内首选）</li>
 *   <li>有 {@code SERPAPI_KEY} → serpapi（国际通用，付费即开即用）</li>
 *   <li>有 {@code SEARXNG_URL} → searxng（开源自托管，免费）</li>
 *   <li>都没有 → 占位 zhipu provider，isReady() 为 false，由调用方提示用户</li>
 * </ol>
 *
 * 显式 {@code SEARCH_PROVIDER}（zhipu / serpapi / searxng）会跳过自动判断。
 *
 * 这里不做单例缓存，由调用方按需缓存（如 ToolRegistry 的 webSearchProvider 字段）。
 */
public final class SearchProviderFactory {

    private static final Logger log = LoggerFactory.getLogger(SearchProviderFactory.class);

    private SearchProviderFactory() {}

    public static SearchProvider create() {
        String provider = readEnv("SEARCH_PROVIDER");
        String glmKey = readEnv("GLM_API_KEY");
        String zhipuEngine = readEnv("ZHIPU_SEARCH_ENGINE");
        String serpKey = readEnv("SERPAPI_KEY");
        String searxngUrl = readEnv("SEARXNG_URL");

        String chosen = pickProvider(provider, glmKey, serpKey, searxngUrl);
        log.info("SearchProvider chosen: {}", chosen);

        return switch (chosen) {
            case "searxng" -> new SearxngSearchProvider(searxngUrl);
            case "serpapi" -> new SerpApiSearchProvider(serpKey);
            default -> new ZhipuSearchProvider(glmKey, zhipuEngine);
        };
    }

    static String pickProvider(String explicit, String glmKey, String serpKey, String searxngUrl) {
        if (explicit != null && !explicit.isBlank()) {
            return explicit.trim().toLowerCase(Locale.ROOT);
        }
        if (glmKey != null && !glmKey.isBlank()) {
            return "zhipu";
        }
        if (serpKey != null && !serpKey.isBlank()) {
            return "serpapi";
        }
        if (searxngUrl != null && !searxngUrl.isBlank()) {
            return "searxng";
        }
        return "zhipu"; // 默认占位（Wraith 主要面向 GLM 用户），isReady() 会为 false
    }

    /** {@code KEY 名 → WraithConfig 的 provider 名}；不在表里的 key 不查 config。 */
    private static String providerForKey(String key) {
        return "GLM_API_KEY".equals(key) ? "glm" : null;
    }

    /**
     * 单个 key 的完整取值：先走 env/属性/.env（{@code envLookup}），再回落 config.json
     * （{@code configLookup}，按 provider 名查）。两个来源都注入，便于不碰真实环境地单测。
     *
     * <p>config 侧任何异常都吞掉当作"没有"——配置文件坏了不该把整条搜索链路带崩，
     * 用户会看到的是 provider 的"未配置"提示，那是可行动的；一个堆栈不是。
     */
    static String resolveKey(String key,
                             java.util.function.Function<String, String> envLookup,
                             java.util.function.Function<String, String> configLookup) {
        String fromEnv = envLookup.apply(key);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv.trim();
        }
        String provider = providerForKey(key);
        if (provider == null) {
            return null;
        }
        try {
            String fromConfig = configLookup.apply(provider);
            return fromConfig == null || fromConfig.isBlank() ? null : fromConfig.trim();
        } catch (Exception e) {
            log.warn("读取 ~/.wraith/config.json 失败,搜索 key 回落为未配置: {}", e.getMessage());
            return null;
        }
    }

    /** 生产入口：env/属性/.env 由 {@link #readEnvOnly}，config 由 {@link com.lyhn.wraith.config.WraithConfig}。 */
    private static String readEnv(String key) {
        return resolveKey(key,
                SearchProviderFactory::readEnvOnly,
                provider -> com.lyhn.wraith.config.WraithConfig.load().getApiKey(provider));
    }

    private static String readEnvOnly(String key) {
        String fromEnv = System.getenv(key);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv.trim();
        }
        String fromProp = System.getProperty(key);
        if (fromProp != null && !fromProp.isBlank()) {
            return fromProp.trim();
        }
        return readFromDotEnv(key);
    }

    private static String readFromDotEnv(String key) {
        File[] envFiles = {new File(".env"), new File(System.getProperty("user.home"), ".env")};
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
            } catch (Exception ignored) {
            }
        }
        return null;
    }
}
