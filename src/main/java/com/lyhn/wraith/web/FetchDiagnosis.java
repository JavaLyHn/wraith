package com.lyhn.wraith.web;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 给 {@code web_fetch} 的回包补一句诚实话。
 *
 * <p><b>它解决的问题</b>：用户让 agent 抓 GitHub，抓取 HTTP 200 成功，但提取出来的是一小坨
 * 导航壳。回包对此一个字都没说 —— 只是把那坨文本递给模型。模型看到一堆无关内容，
 * 自己编了个因果，对用户讲「网页抓取不了 GitHub」。<b>抓取成功却被说成失败</b>，
 * 而用户没有任何办法看出这句话是编的。
 *
 * <p><b>纪律</b>：这里只报已知的<b>事实</b> —— HTTP 已成功、原始 HTML 多大、提取到多少字、
 * URL 是什么形状。不评价页面质量，不猜页面为什么这样。凡是 URL 里切不出来的东西
 * （GitHub 的分支名可能含 {@code /}，无法与目录路径唯一切分）就留成占位符，绝不拼一个猜的值出来。
 */
public final class FetchDiagnosis {

    /** 提取到的正文短于此就算「几乎没提到正文」。 */
    static final int THIN_MARKDOWN_CHARS = 500;

    /** 原始 HTML 至少这么大，「正文只有几百字」才算可疑（纯文本接口本来就短）。 */
    static final int LARGE_HTML_CHARS = 20_000;

    private FetchDiagnosis() {}

    /**
     * @param url          抓取的 URL
     * @param markdownChars 提取到的正文字数（0 表示没提取到，那句话归
     *                      {@link FetchResult#ok} 的 hint 说，这里不重复）
     * @param htmlChars    原始 HTML 字数
     * @return 要追加到回包里的提示；无话可说时返回 {@code ""}
     */
    public static String advise(String url, int markdownChars, int htmlChars) {
        List<String> parts = new ArrayList<>();
        if (markdownChars > 0 && markdownChars < THIN_MARKDOWN_CHARS && htmlChars >= LARGE_HTML_CHARS) {
            parts.add("抓取本身是成功的（HTTP 200，原始 HTML " + htmlChars + " 字），"
                    + "但只提取到 " + markdownChars + " 字正文 —— 这一页的正文很可能由 JS 渲染。"
                    + "不要据此断言「这个站点抓不了」；换一个等价的纯文本入口再试。");
        }
        String route = plainTextRoute(url);
        if (!route.isEmpty()) {
            parts.add(route);
        }
        return String.join("\n", parts);
    }

    /**
     * 已知有等价纯文本入口的 URL 形状。
     *
     * <p>目前只有 GitHub —— 它是 agent 最常抓的站，且换算规则是确定的：
     * <ul>
     *   <li>{@code /blob/<rest>} → {@code raw.githubusercontent.com/<owner>/<repo>/<rest>}。
     *       <b>整段照搬</b>，所以分支名含 {@code /}（如 {@code feat/windows-parity-block1}）
     *       也不会错 —— 根本不需要切分 ref 与路径。</li>
     *   <li>{@code /tree/…} → 目录清单只能走 API，而 ref 与目录路径<b>无法</b>从 URL 唯一切分。
     *       所以只给端点形状 + 能确定的 owner/repo，两个切不出来的部分留占位符。</li>
     * </ul>
     */
    static String plainTextRoute(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        URI uri;
        try {
            uri = URI.create(url.trim());
        } catch (Exception malformed) {
            return "";   // 诊断层崩掉会把一次成功的抓取变成「抓取失败」,不值得
        }
        String host = uri.getHost();
        if (host == null) {
            return "";
        }
        host = host.toLowerCase(Locale.ROOT);
        if (!"github.com".equals(host) && !"www.github.com".equals(host)) {
            return "";
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        String[] seg = path.split("/");
        // seg[0] 是前导 / 切出的空串,故 owner=1、repo=2、kind=3
        if (seg.length < 5) {
            return "";
        }
        String owner = seg[1];
        String repo = seg[2];
        String kind = seg[3];
        if (owner.isEmpty() || repo.isEmpty()) {
            return "";
        }
        String rest = String.join("/", java.util.Arrays.copyOfRange(seg, 4, seg.length));
        if ("blob".equals(kind)) {
            return "这个 URL 有等价的纯文本入口，直接抓它更可靠："
                    + "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + rest;
        }
        if ("tree".equals(kind)) {
            return "GitHub 目录页：文件清单请走 API "
                    + "https://api.github.com/repos/" + owner + "/" + repo + "/contents/<目录>?ref=<分支>"
                    + "（分支名可能含 /，无法从这个 URL 唯一切分出 ref 与目录，故留占位符）；"
                    + "读单个文件把 /blob/ 换成 raw.githubusercontent.com。";
        }
        return "";
    }
}
