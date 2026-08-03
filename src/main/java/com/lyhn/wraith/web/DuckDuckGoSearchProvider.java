package com.lyhn.wraith.web;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * DuckDuckGo HTML 后端 —— <b>显式可选，永不自动选</b>。
 *
 * <p>它是本仓库里唯一零 key 的搜索后端，也是唯一被明确判定为<b>不可靠</b>的一个：
 * 没有免费 JSON API，能用的只有抓 {@code html.duckduckgo.com} 再解页面标记，
 * 人家改版就碎、请求多了会被限流。
 *
 * <p><b>可达性被刻意收窄到一条</b>：只有 {@code SEARCH_PROVIDER=duckduckgo} 或
 * {@code /config search --provider duckduckgo} 能拿到它；
 * {@link SearchProviderFactory#pickProvider} 的自动选择链<b>永远不返回它</b>
 * （由 {@code SearchProviderAutoSelectionTest} 穷举 8 种组合守门）。因此它无法静默降低
 * 任何人的搜索质量——那正是它被接受的条件。
 *
 * <p><b>失败契约</b>：HTTP 非 200、被限流、或解析出 0 条结果，一律抛 {@link IOException}，
 * <b>绝不返回空列表</b>。空列表和「网上没有这个信息」在模型眼里是同一件事，它会据此
 * 编造结论；异常则明确是「工具坏了」。这条契约不是可选的打磨。
 *
 * <p><b>明确不做</b>：不加重试、不加 UA 轮换、不加代理。那些是在跟对方的反爬对抗，
 * 一旦开始就没有尽头，且更接近 ToS 灰区。抓一次，不行就报错。
 */
public class DuckDuckGoSearchProvider implements SearchProvider {

    private static final Logger log = LoggerFactory.getLogger(DuckDuckGoSearchProvider.class);
    private static final String DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
    /** 默认 UA 会被限流得更快，伪装成常见浏览器。这不是反爬对抗，只是别自报是脚本。 */
    private static final String BROWSER_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

    private final String endpoint;
    private final OkHttpClient httpClient;

    /** 生产入口。超时与 {@link SearxngSearchProvider} 对齐。 */
    public DuckDuckGoSearchProvider() {
        this(DEFAULT_ENDPOINT, new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .build());
    }

    /** endpoint 与 client 都注入，测试用 MockWebServer 顶上，不真连 duckduckgo.com。 */
    DuckDuckGoSearchProvider(String endpoint, OkHttpClient httpClient) {
        this.endpoint = endpoint;
        this.httpClient = httpClient;
    }

    @Override
    public String name() {
        return "duckduckgo";
    }

    /** 恒真 —— 没有 key 可缺。 */
    @Override
    public boolean isReady() {
        return true;
    }

    /**
     * 因 {@link #isReady()} 恒真而不会被展示，但仍要返回一句实话：留一句空串会让
     * 后来人以为这里没写完。
     */
    @Override
    public String unavailableHint() {
        return "duckduckgo 后端不需要任何 key，所以不会「未配置」——它只会因改版或限流而失败。"
                + "稳定用途请改用 searxng / serpapi / zhipu：/config search --provider <名字>";
    }

    @Override
    public List<SearchResult> search(String query, int topK) throws IOException {
        int maxResults = topK > 0 ? Math.min(topK, 10) : 5;

        HttpUrl parsed = HttpUrl.parse(endpoint);
        if (parsed == null) {
            throw new IOException(failureMessage("endpoint 非法: " + endpoint));
        }
        HttpUrl url = parsed.newBuilder().addQueryParameter("q", query).build();
        Request request = new Request.Builder()
                .url(url)
                .header("User-Agent", BROWSER_UA)
                .header("Accept", "text/html")
                .get()
                .build();
        log.info("DuckDuckGo search: query={}, topK={}", query, maxResults);

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException(failureMessage("HTTP " + response.code()));
            }
            String body = response.body() == null ? "" : response.body().string();
            List<SearchResult> results = parse(body, maxResults);
            if (results.isEmpty()) {
                throw new IOException(failureMessage("没有解析到任何结果（0 条）"));
            }
            return results;
        }
    }

    /** jsoup 解析。不手写正则——正则抓 HTML 是在脆弱之上再叠一层脆弱。 */
    private List<SearchResult> parse(String html, int maxResults) {
        Document document = Jsoup.parse(html);
        Elements anchors = document.select("a.result__a");
        Elements snippets = document.select("a.result__snippet");

        List<SearchResult> out = new ArrayList<>();
        for (int i = 0; i < anchors.size() && out.size() < maxResults; i++) {
            Element anchor = anchors.get(i);
            String link = anchor.attr("href");
            String title = anchor.text();
            if (link.isBlank() || title.isBlank()) {
                continue;
            }
            String snippet = i < snippets.size() ? snippets.get(i).text() : "";
            out.add(SearchResult.of(out.size() + 1, title, link, snippet));
        }
        return out;
    }

    private String failureMessage(String cause) {
        return "DuckDuckGo 后端失败（" + cause + "）。这个后端靠抓 HTML，改版或限流都会这样。"
                + "稳定用途请改用 searxng / serpapi / zhipu："
                + "/config search --provider searxng --base-url " + SearchDetection.SEARXNG_LOCAL_URL;
    }
}
