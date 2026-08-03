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
 * → <b>{@code ~/.wraith/config.json} 的 {@code search} 节</b>。
 * 补 config.json 这一环的原因：桌面「Provider 配置」面板保存到的正是它，而此前这里读不到，
 * 于是「在 GUI 里配好了 GLM，web_search 仍然报未配置」——
 * 与文档里到处写的「CLI 与桌面共享同一份配置」直接冲突。
 *
 * <p><b>三条路的取值链现在是对等的</b>：都能从 {@code search} 节读到。此前只有
 * {@code GLM_API_KEY} 能回落 config.json（它蹭的是 {@code providers.glm.apiKey}），
 * {@code SERPAPI_KEY} / {@code SEARXNG_URL} 在 config.json 里没有对应概念，只能来自环境变量
 * ——「只有配了 GLM 的人 web_search 才零配置可用」的全部机制就是这个不对等。
 * GLM 额外保留 {@code providers.glm.apiKey} 那条回落：推理与搜索共用一个 key 是智谱的
 * 产品事实，删掉是无谓回归。「对等」是抬高低的，不是压低高的。
 *
 * 自动选择优先级（未显式 SEARCH_PROVIDER 时）：
 * <ol>
 *   <li>有 {@code GLM_API_KEY} → zhipu（智谱 Web Search，与 GLM 推理共用 Key）</li>
 *   <li>有 {@code SERPAPI_KEY} → serpapi（国际通用，付费即开即用）</li>
 *   <li>有 {@code SEARXNG_URL} → searxng（开源自托管，免费无需 key）</li>
 *   <li>都没有 → {@link UnconfiguredSearchProvider}，isReady() 为 false，由调用方提示用户</li>
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
        return create(resolveProductionSettings());
    }

    /** 取值由调用方给出的重载 —— 测试用它避开真实 env 与真实 config.json。 */
    static SearchProvider create(SearchSettings settings) {
        String chosen = pickProvider(settings.provider(), settings.glmKey(),
                settings.serpKey(), settings.searxngUrl());
        log.info("SearchProvider chosen: {}", chosen);

        return switch (chosen) {
            case "searxng" -> new SearxngSearchProvider(settings.searxngUrl());
            case "serpapi" -> new SerpApiSearchProvider(settings.serpKey());
            case "unconfigured" -> new UnconfiguredSearchProvider();
            // default 是 zhipu：显式 SEARCH_PROVIDER 写了别的值时也落到这里,
            // 由 ZhipuSearchProvider 自己报「没有 GLM_API_KEY」。
            default -> new ZhipuSearchProvider(settings.glmKey(), settings.zhipuEngine());
        };
    }

    /**
     * 生产取值：env/属性/.env 由 {@link #readEnvOnly}，{@code search} 节与
     * {@code providers.glm.apiKey} 由 {@link com.lyhn.wraith.config.WraithConfig#load()}。
     *
     * <p>config <b>只加载一次</b>（旧写法每个 key 加载一遍，共四遍，既浪费也可能读到
     * 不一致的快照）。加载本身失败时退化成「只有 env」，理由同 {@link #resolveSettings}
     * 的吞异常约定。
     */
    private static SearchSettings resolveProductionSettings() {
        com.lyhn.wraith.config.WraithConfig config = null;
        try {
            config = com.lyhn.wraith.config.WraithConfig.load();
        } catch (Exception e) {
            log.warn("加载 ~/.wraith/config.json 失败,搜索配置只用环境变量: {}", e.getMessage());
        }
        com.lyhn.wraith.config.WraithConfig loaded = config;
        return resolveSettings(SearchProviderFactory::readEnvOnly,
                loaded == null ? null : loaded.getSearch(),
                provider -> loaded == null ? null : loaded.getApiKey(provider));
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
        return "unconfigured"; // 载体换成 UnconfiguredSearchProvider —— 见 D2
    }

    /**
     * 三条路的最终取值，一次解析完。
     *
     * <p>为什么是一个四元组而不是四次单 key 查询：旧写法里每个 key 各自
     * {@code WraithConfig.load()} 一遍（一共四遍），既浪费也可能读到不一致的快照。
     */
    record SearchSettings(String provider, String glmKey, String serpKey,
                          String searxngUrl, String zhipuEngine) {}

    /**
     * 取值链：<b>env / 系统属性 / .env（{@code envLookup}）→ config.json 的 {@code search} 节
     * → {@code providers.glm.apiKey}（仅 GLM，既有回落）</b>。
     *
     * <p>三个来源全部注入，便于不碰真实环境地单测（本仓库既有做法）。
     *
     * <p><b>{@code apiKey} 只在 {@code provider} 明确时才被读取。</b> 一个字段服务 zhipu 与
     * serpapi 两家，靠 {@code provider} 区分；{@code provider} 为空时不猜归属，宁可报「未配置」
     * ——猜错会把 SerpAPI 的 key 发给智谱（或反之）。
     *
     * <p>{@code providerKeyLookup} 抛出的任何异常都吞掉当作「没有」——配置文件坏了不该把整条
     * 搜索链路带崩，用户会看到的是「未配置」提示，那是可行动的；一个堆栈不是。
     */
    static SearchSettings resolveSettings(java.util.function.Function<String, String> envLookup,
                                          com.lyhn.wraith.config.WraithConfig.SearchConfig search,
                                          java.util.function.Function<String, String> providerKeyLookup) {
        String provider = firstNonBlank(envLookup.apply("SEARCH_PROVIDER"),
                search == null ? null : search.getProvider());
        String searxngUrl = firstNonBlank(envLookup.apply("SEARXNG_URL"),
                search == null ? null : search.getBaseUrl());
        String searchApiKey = search == null ? null : search.getApiKey();
        String normalizedProvider = provider == null ? "" : provider.toLowerCase(Locale.ROOT);

        String serpKey = firstNonBlank(envLookup.apply("SERPAPI_KEY"),
                "serpapi".equals(normalizedProvider) ? searchApiKey : null);
        String glmKey = firstNonBlank(envLookup.apply("GLM_API_KEY"),
                "zhipu".equals(normalizedProvider) ? searchApiKey : null,
                lookupQuietly(providerKeyLookup, "glm"));

        return new SearchSettings(provider, glmKey, serpKey, searxngUrl,
                firstNonBlank(envLookup.apply("ZHIPU_SEARCH_ENGINE")));
    }

    /** 第一个非空白值（已 trim），全空则 {@code null}。 */
    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    private static String lookupQuietly(java.util.function.Function<String, String> lookup, String provider) {
        try {
            return lookup.apply(provider);
        } catch (Exception e) {
            log.warn("读取 ~/.wraith/config.json 失败,搜索 key 回落为未配置: {}", e.getMessage());
            return null;
        }
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
