package com.lyhn.wraith.web;

import com.lyhn.wraith.config.SecretRedaction;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 「测试连接」按钮的后端：用<b>表单里那套值</b>发一次真实搜索，把结论摊开。
 *
 * <p><b>为什么需要它</b>：此前验证搜索后端唯一的办法是回聊天里问一句、看 agent 报什么错。
 * SearXNG 端口写错、SerpAPI key 少一位、智谱 key 其实过期 —— 三种故障在聊天里
 * 都表现成同一句「搜索不可用」。
 *
 * <p><b>刻意不读 env / config.json</b>：只用调用方给的三个值构造 provider。
 * 若这里回落到既有配置，就会出现「表单填错了但测试通过」（因为实际用的是旧值），
 * 那比没有这个按钮更糟。
 *
 * <p>回包字段：
 * <ul>
 *   <li>{@code provider} —— <b>实际生效</b>的那个（表单值经归一化后的）。</li>
 *   <li>{@code results} —— 拿到几条。**0 条也算失败**：连得上但搜不出东西，
 *       对用户来说和连不上没有区别（SearXNG 装好了但没启用任何搜索引擎就是这个表现）。</li>
 *   <li>{@code latencyMs} —— 一次搜索的耗时。agent 每轮可能搜好几次，慢是要知道的。</li>
 *   <li>{@code sample} —— 第一条结果的标题，用来一眼确认「搜到的是真东西」。</li>
 *   <li>{@code error} —— 失败原文，<b>保留原文</b>：「连不上」「401」「429 限流」
 *       是三件不同的事，只给一句友好话会把人引到错的地方去查。key 已抹除。</li>
 * </ul>
 */
public final class SearchProbe {

    private SearchProbe() {
    }

    /**
     * 探测用的查询词。
     *
     * <p>刻意用一个<b>会有结果</b>的普通英文词组：太生僻的词在小众后端上本就搜不到，
     * 那会把一个好后端判成失败。
     */
    public static final String PROBE_QUERY = "model context protocol";

    /** 错误原文的截断长度：有的服务端会把整页 HTML 塞进 4xx 响应体。 */
    private static final int MAX_ERROR_CHARS = 300;

    /** 期望结果数：只要够判断「有内容」，不必拉满。 */
    private static final int PROBE_TOP_K = 3;

    /**
     * 表单里的 key 与已存的 key 之间取实际生效的那个。
     *
     * <p>语义必须与 {@link SearchConfigRules#apply} 的「空 = 保留旧」严格一致 ——
     * 测的必须正是保存会落盘的那套。表单从不回填已存 key（{@code config.getSearch}
     * 只回 {@code hasKey}），若这里不继承，「测试连接」就永远是 401 而保存却是好的。
     *
     * <p><b>换了 provider 时不继承</b>：同 {@code apply} 的理由 ——
     * 一个 apiKey 字段服务两家，继承会把 SerpAPI 的 key 发给智谱。
     */
    public static String effectiveKey(String savedProvider, String savedKey,
                                      String formProvider, String formKey) {
        if (formKey != null && !formKey.isBlank()) {
            return formKey.trim();
        }
        boolean sameProvider = SearchConfigRules.normalize(savedProvider)
                .equals(SearchConfigRules.normalize(formProvider));
        return sameProvider && savedKey != null ? savedKey : "";
    }

    /**
     * 只用给定的三个值构造 provider 并发一次真实搜索。
     *
     * @param apiKey 已由 {@link #effectiveKey} 解析过的最终 key；也用于把它从错误原文里抹掉
     */
    public static Map<String, Object> probe(String provider, String apiKey, String baseUrl) {
        String normalized = SearchConfigRules.normalize(provider);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", normalized);

        SearchConfigRules.Violation violation = SearchConfigRules.check(provider, apiKey, baseUrl);
        if (violation != null) {
            out.put("ok", false);
            out.put("error", SearchConfigRules.formMessage(violation, provider));
            return out;
        }

        SearchProvider target = SearchProviderFactory.create(explicitSettings(normalized, apiKey, baseUrl));
        if (!target.isReady()) {
            out.put("ok", false);
            out.put("error", target.unavailableHint());
            return out;
        }

        long startedNanos = System.nanoTime();
        try {
            List<SearchResult> results = target.search(PROBE_QUERY, PROBE_TOP_K);
            out.put("latencyMs", (System.nanoTime() - startedNanos) / 1_000_000L);
            int count = results == null ? 0 : results.size();
            out.put("results", count);
            if (count == 0) {
                // 连得上但搜不出东西 —— 对用户来说和连不上没区别,不能报 ok
                out.put("ok", false);
                out.put("error", "连上了,但没有返回任何结果。"
                        + ("searxng".equals(normalized)
                        ? "SearXNG 实例可能没启用任何搜索引擎,或禁用了 JSON 输出格式。"
                        : "换个关键词再试,或检查这个后端的配额。"));
                return out;
            }
            out.put("ok", true);
            String title = results.get(0).title();
            out.put("sample", title == null ? "" : title);
            return out;
        } catch (Exception e) {
            out.put("latencyMs", (System.nanoTime() - startedNanos) / 1_000_000L);
            out.put("ok", false);
            out.put("error", describe(e, apiKey));
            return out;
        }
    }

    /** 只含表单值的取值组 —— provider 决定那个 apiKey 归谁。 */
    private static SearchProviderFactory.SearchSettings explicitSettings(
            String normalized, String apiKey, String baseUrl) {
        String key = apiKey == null ? "" : apiKey;
        return new SearchProviderFactory.SearchSettings(
                normalized,
                "zhipu".equals(normalized) ? key : null,
                "serpapi".equals(normalized) ? key : null,
                baseUrl,
                null);
    }

    /** 异常 → 一行可读原文；key 抹除，过长截断。（包可见：抹除与截断值得单独验，不必为此真连网） */
    static String describe(Throwable error, String apiKey) {
        String message = error.getMessage();
        String text = (message == null || message.isBlank())
                ? error.getClass().getSimpleName()
                : error.getClass().getSimpleName() + ": " + message.trim();
        String redacted = apiKey == null || apiKey.isBlank()
                ? text
                : SecretRedaction.redact(text, apiKey);
        return redacted.length() > MAX_ERROR_CHARS
                ? redacted.substring(0, MAX_ERROR_CHARS) + "…"
                : redacted;
    }
}
