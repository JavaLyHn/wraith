package com.lyhn.wraith.web;

import java.io.IOException;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * 「搜索还没配」这句话的载体。
 *
 * <p><b>为什么要单独一个类</b>：{@code pickProvider} 此前在什么都没配时返回 {@code "zhipu"}
 * 作占位，于是那条中立的「三条路都给你」的提示物理上挂在 {@link ZhipuSearchProvider} 上。
 * 用户截图里模型开口就提 GLM，原因就是它读到的可用信息是智谱 provider 在说话。
 * 提示的<b>内容</b>早就改成三路并列了，但<b>载体</b>没换，这层错位一直在。
 *
 * <p>两个检测函数都注入：生产用真实实现（{@link SearchDetection}），测试给常量，
 * 于是这个类是纯文本组合，不碰 PATH、不碰网络。
 */
public class UnconfiguredSearchProvider implements SearchProvider {

    /** 端口常量的家在 {@link SearchDetection}（依赖单向：本类 → SearchDetection）。 */
    static final String CONFIG_SEARXNG_COMMAND =
            "/config search --provider searxng --base-url " + SearchDetection.SEARXNG_LOCAL_URL;

    private final BooleanSupplier dockerOnPath;
    private final BooleanSupplier searxngPortListening;

    /** 生产入口。 */
    public UnconfiguredSearchProvider() {
        this(SearchDetection::dockerOnPath, SearchDetection::searxngPortListening);
    }

    UnconfiguredSearchProvider(BooleanSupplier dockerOnPath, BooleanSupplier searxngPortListening) {
        this.dockerOnPath = dockerOnPath;
        this.searxngPortListening = searxngPortListening;
    }

    @Override
    public String name() {
        return "unconfigured";
    }

    @Override
    public boolean isReady() {
        return false;
    }

    /**
     * 三段，顺序固定：中立的三路指引 → 本机检测结果 → 两条兜底出口。
     *
     * <p><b>兜底必须排在最后且各自带警示</b>，否则一条不稳定的应急路排在三条正路前面，
     * 读起来就是推荐。{@code UnconfiguredHintTest} 断言的是下标顺序而不是「包含」——
     * 只断言包含的话，把兜底放到开头也能过。
     */
    @Override
    public String unavailableHint() {
        StringBuilder out = new StringBuilder();
        out.append("web_search 还没有配搜索后端。三条路任选一条：\n");
        out.append("  1) SEARXNG —— 自托管开源元搜索，**免费且不需要任何 key**\n");
        out.append("  2) SERPAPI_KEY —— 国际通用，付费即开即用：https://serpapi.com/manage-api-key\n");
        out.append("  3) GLM_API_KEY —— 智谱 Web Search，与 GLM 推理共用同一个 key\n");
        out.append(detectionAdvice());
        out.append("另外两条应急路（都不需要 key，但都不如上面三条稳）：\n");
        out.append("  · 让我用浏览器去搜 —— 内建 chrome-devtools MCP，需要本机有 Node/npx；比 API 慢，但能用\n");
        out.append("  · /config search --provider duckduckgo —— 靠抓 HTML，可能因改版或限流失效，只建议临时用\n");
        return out.toString();
    }

    /**
     * 检测结果段。<b>不缓存</b>：提示是低频路径（只在搜索不可用时出现），而缓存会让
     * 「用户刚起了 docker、再问一次却还说没有」——又一个 snapshot-vs-live。
     */
    private String detectionAdvice() {
        if (searxngPortListening.getAsBoolean()) {
            return "检测到 localhost:" + SearchDetection.SEARXNG_DEFAULT_PORT
                    + " 有服务在听（可能已经是 SearXNG）。执行：\n"
                    + "  " + CONFIG_SEARXNG_COMMAND + "\n";
        }
        if (dockerOnPath.getAsBoolean()) {
            return "本机有 docker，最快的路是起一个 SearXNG（免费、无需任何 key）：\n"
                    + "  docker run --rm -p " + SearchDetection.SEARXNG_DEFAULT_PORT
                    + ":" + SearchDetection.SEARXNG_DEFAULT_PORT + " searxng/searxng\n"
                    + "  " + CONFIG_SEARXNG_COMMAND + "\n";
        }
        return "本机没找到 docker，所以 SEARXNG 那条要先装 docker；"
                + "另两条各有代价（一条付费、一条要智谱的 key）。\n";
    }

    @Override
    public List<SearchResult> search(String query, int topK) throws IOException {
        throw new IOException(unavailableHint());
    }
}
