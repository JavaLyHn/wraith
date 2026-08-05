package com.lyhn.wraith.web;

import java.util.Locale;
import java.util.Set;

/**
 * 搜索后端配置的合法性规则 —— <b>CLI 与桌面共用同一份</b>。
 *
 * <p><b>为什么抽出来</b>：这些规则原先只写在 {@code Main.parseSearchConfigUpdate} 里，
 * 而那是一个<b>命令行解析器</b>。桌面端要能配搜索后端（用户实测发现只有
 * {@code config.getSearch}、没有 {@code config.setSearch}），若在 app-server 那侧重写一遍，
 * 两条路会漂 —— 而漂的方向恰好是「桌面存进一个 CLI 认为非法的配置」。
 *
 * <p><b>为什么返回「违反了哪条」而不是一句现成的话</b>：CLI 的报错该点出旗标名
 * （「缺少 {@code --base-url}」），桌面的表单不该（那里没有旗标，只有输入框）。
 * <b>规则单一来源、措辞各自表述</b>；若这里直接返回文案，两边必有一边说的是另一边的话。
 *
 * <p>三条规则各有由来，都不是形式主义：
 * <ol>
 *   <li><b>provider 必需</b>。一个 {@code apiKey} 字段服务 zhipu 与 serpapi 两家，
 *       provider 为空时「这个 key 属于谁」不可猜 —— 猜错会把 SerpAPI 的 key 发给智谱。</li>
 *   <li><b>searxng 必须给 baseUrl</b>。它是自托管实例，没有公共地址可默认。</li>
 *   <li><b>duckduckgo 给了 key/baseUrl 要报错</b>。静默吞掉会让用户以为 key 生效了，
 *       之后排查不可能。</li>
 * </ol>
 */
public final class SearchConfigRules {

    private SearchConfigRules() {
    }

    /** 支持的四个后端。duckduckgo 见 D6：显式可选，自动选择链永不选它。 */
    public static final Set<String> PROVIDERS = Set.of("zhipu", "serpapi", "searxng", "duckduckgo");

    /** 可读的支持列表，给各家报错文案拼用。 */
    public static final String PROVIDER_LIST = "zhipu / serpapi / searxng / duckduckgo";

    /** 违反了哪一条。 */
    public enum Violation {
        PROVIDER_REQUIRED,
        UNKNOWN_PROVIDER,
        SEARXNG_NEEDS_BASE_URL,
        DUCKDUCKGO_TAKES_NOTHING,
    }

    /** 小写去空白；null/空白 → 空串。 */
    public static String normalize(String provider) {
        return provider == null ? "" : provider.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * <b>规则本身</b>。
     *
     * @param provider 后端名（大小写不敏感）
     * @param apiKey   给的 key；<b>空白视为「没给」</b>（表单里的空输入框与命令行里没写这个旗标等价）
     * @param baseUrl  同上
     * @return 违反的那一条；{@code null} = 合法
     */
    public static Violation check(String provider, String apiKey, String baseUrl) {
        String normalized = normalize(provider);
        if (normalized.isEmpty()) {
            return Violation.PROVIDER_REQUIRED;
        }
        if (!PROVIDERS.contains(normalized)) {
            return Violation.UNKNOWN_PROVIDER;
        }
        boolean hasKey = apiKey != null && !apiKey.isBlank();
        boolean hasUrl = baseUrl != null && !baseUrl.isBlank();
        if ("searxng".equals(normalized) && !hasUrl) {
            return Violation.SEARXNG_NEEDS_BASE_URL;
        }
        if ("duckduckgo".equals(normalized) && (hasKey || hasUrl)) {
            return Violation.DUCKDUCKGO_TAKES_NOTHING;
        }
        return null;
    }

    /**
     * 把一次配置变更落到 {@code search} 节 —— <b>CLI 与桌面共用</b>。
     *
     * <p>两条语义，都不显然：
     * <ol>
     *   <li><b>空 = 保留旧值</b>（同 {@code embeddingSet}）。表单不回填 key，
     *       所以空输入框必须是「别动」而不是「清空」。</li>
     *   <li><b>换了 provider 就<u>不</u>继承旧 key</b>。这是本方法存在的主要理由：
     *       {@code search} 节只有<b>一个</b> {@code apiKey} 字段，却服务 zhipu 与 serpapi 两家。
     *       从 serpapi 切到 zhipu 而不重填 key 时，若沿用旧值，就是<b>把 SerpAPI 的 key
     *       发给智谱</b>。宁可清空 —— 那会得到一句「未配置」，是可行动的；
     *       而把 key 发错家会得到一个 401，用户只会以为 key 坏了。</li>
     * </ol>
     */
    public static void apply(com.lyhn.wraith.config.WraithConfig.SearchConfig target,
                             String provider, String apiKey, String baseUrl) {
        String normalized = normalize(provider);
        boolean providerChanged = !normalized.equals(normalize(target.getProvider()));
        target.setProvider(normalized);
        // 清空用 null 而不是空串:空串会在 config.json 里留下一行 apiKey 空值,
        // 读起来像「配过一个空 key」。null = 这一项不存在。
        if (apiKey != null && !apiKey.isBlank()) {
            target.setApiKey(apiKey.trim());
        } else if (providerChanged) {
            target.setApiKey(null);
        }
        if (baseUrl != null && !baseUrl.isBlank()) {
            target.setBaseUrl(baseUrl.trim());
        } else if (providerChanged) {
            target.setBaseUrl(null);
        }
    }

    /**
     * 面向<b>表单</b>的措辞（桌面用）——不提旗标，因为那里没有旗标。
     * CLI 有自己的一套（会点出 {@code --provider} / {@code --base-url} 等）。
     */
    public static String formMessage(Violation violation, String provider) {
        return switch (violation) {
            case PROVIDER_REQUIRED -> "请先选一个搜索后端（" + PROVIDER_LIST + "）";
            case UNKNOWN_PROVIDER -> "未知搜索后端: " + provider + "，只支持 " + PROVIDER_LIST;
            case SEARXNG_NEEDS_BASE_URL -> "SearXNG 需要填实例地址（例如 http://localhost:8888）";
            case DUCKDUCKGO_TAKES_NOTHING -> "DuckDuckGo 不需要 API Key / 实例地址，请清空这两项";
        };
    }
}
