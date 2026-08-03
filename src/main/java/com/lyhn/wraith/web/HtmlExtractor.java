package com.lyhn.wraith.web;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Comment;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;
import org.jsoup.parser.Parser;
import org.jsoup.select.Elements;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 极简版 readability：HTML → 主正文 Markdown。
 *
 * 思路（按优先级）：
 * <ol>
 *   <li>清理噪声标签：script、style、nav、aside、footer、header、form、iframe、广告 class</li>
 *   <li>找主语义容器：&lt;article&gt;、&lt;main&gt;、role="main"</li>
 *   <li>都没有则给所有 block 元素打分（文本长度 - 链接占比惩罚），选最高分</li>
 *   <li>再把选中容器递归转成 Markdown</li>
 * </ol>
 *
 * 不追求与 Mozilla Readability 完全对齐，目标是覆盖博客 / 文档 / 官网这类
 * SSR 页面的常见结构。SPA 渲染后的空 HTML 会得到空字符串，由调用方提示边界。
 */
public class HtmlExtractor {

    private static final Set<String> NOISE_TAGS = Set.of(
            "script", "style", "noscript", "iframe", "nav", "aside",
            "header", "footer", "form", "svg", "canvas", "button"
    );

    private static final Set<String> NOISE_CLASS_KEYWORDS = Set.of(
            "ads", "advert", "banner", "popup", "modal", "subscribe", "newsletter",
            "related", "recommend", "comment", "share", "social", "breadcrumb",
            "sidebar", "promo", "cookie", "footer", "navigation"
    );

    /**
     * class / id 的切段规则：非字母数字处切，驼峰边界处也切。
     *
     * <p>切完只做<b>整段相等</b>比对（见 {@link #hasNoiseSegment}）。此前是裸子串匹配，
     * 于是现代页面的 class 名会<b>偶然</b>命中：{@code SharedPageLayout} 里有 {@code share}、
     * {@code sharepoint} 里也有 —— 命中即连整棵子树删掉，正文就此消失。
     */
    private static final java.util.regex.Pattern SEGMENT_SPLIT =
            java.util.regex.Pattern.compile("[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])");

    /**
     * 一次噪声删除最多能吃掉的正文占比。
     *
     * <p>超过它就不删：占了整页的东西不是噪声，是正文，说明关键词是偶然命中。
     * 实测三个真实页面被误删的元素分别占正文 99% / 99% / 102%，正常的侧栏 / 评论区不会这么大。
     */
    private static final double MAX_NOISE_SHARE = 0.5;

    public Extracted extract(String html, String baseUrl) {
        Document doc = Jsoup.parse(html, baseUrl == null ? "" : baseUrl, Parser.htmlParser());
        String title = pickTitle(doc);

        cleanNoise(doc);
        Element main = pickMainElement(doc);

        if (main == null) {
            return new Extracted(title, "");
        }

        StringBuilder out = new StringBuilder();
        renderChildren(main, out, false);
        String markdown = collapseBlankLines(out.toString()).trim();
        return new Extracted(title, markdown);
    }

    private String pickTitle(Document doc) {
        String t = doc.title();
        if (t != null && !t.isBlank()) return t.trim();
        Element h1 = doc.selectFirst("h1");
        return h1 == null ? "" : h1.text().trim();
    }

    /**
     * 清理噪声：先按标签，再按 class/id 关键词。
     *
     * <p><b>三条护栏</b>，各自有一个真实页面作证人（缺一条就漏一个页面，见
     * {@code HtmlExtractorNoiseGuardTest}）：
     * <ol>
     *   <li>{@code html} / {@code body} 永不删 —— 维基把 {@code navigation} 写进了
     *       {@code <html>} 的 class，旧写法把整个文档 remove 了，提取结果是 0 字</li>
     *   <li>关键词按<b>词段</b>比而非裸子串 —— GitHub 正文容器叫
     *       {@code SharedPageLayout-module__content}，{@code Shared} 不是 {@code share}</li>
     *   <li>一次删除不得吃掉正文的一半以上 —— MDN 主布局叫 {@code layout__2-sidebars-inline}，
     *       复数确实命中 {@code sidebar}，只有这条能救它</li>
     * </ol>
     */
    private void cleanNoise(Document doc) {
        for (String tag : NOISE_TAGS) {
            doc.select(tag).remove();
        }
        // 分母在标签清理之后取一次快照:若边删边算,后面的删除会因分母变小而显得"占比不高"
        int bodyTextLength = doc.body() == null ? 0 : doc.body().text().length();
        for (Element el : doc.select("[class],[id]")) {
            if (el.ownerDocument() == null) {
                continue;   // 已被某个祖先带走,别重复记账
            }
            if (isStructuralRoot(el) || !hasNoiseSegment(el.className() + " " + el.id())) {
                continue;
            }
            if (bodyTextLength > 0 && el.text().length() > bodyTextLength * MAX_NOISE_SHARE) {
                continue;   // 它就是正文本身,关键词是偶然命中
            }
            el.remove();
        }
    }

    /** 文档骨架不参与噪声判定：删掉它等于删掉整页。 */
    private static boolean isStructuralRoot(Element el) {
        String tag = el.tagName().toLowerCase(Locale.ROOT);
        return "html".equals(tag) || "body".equals(tag);
    }

    /**
     * 切段后<b>整段相等</b>才算命中噪声词（容许末尾复数 {@code s}，如 {@code post-comments}）。
     *
     * <p>复数容许是有代价的：MDN 的 {@code sidebars} 也因此命中 —— 那由
     * {@link #MAX_NOISE_SHARE} 兜住。反过来若不容许复数，{@code comments} / {@code banners}
     * 这类最常见的真噪声就全漏了。
     */
    static boolean hasNoiseSegment(String marker) {
        if (marker == null || marker.isBlank()) {
            return false;
        }
        for (String segment : SEGMENT_SPLIT.split(marker)) {
            if (segment.isEmpty()) {
                continue;
            }
            String s = segment.toLowerCase(Locale.ROOT);
            if (NOISE_CLASS_KEYWORDS.contains(s)) {
                return true;
            }
            if (s.length() > 1 && s.endsWith("s")
                    && NOISE_CLASS_KEYWORDS.contains(s.substring(0, s.length() - 1))) {
                return true;
            }
        }
        return false;
    }

    private Element pickMainElement(Document doc) {
        Element semantic = doc.selectFirst("article, main, [role=main]");
        if (semantic != null && semantic.text().length() > 80) {
            return semantic;
        }
        // 给候选 block 元素打分
        Elements candidates = doc.select("div, section, article, main");
        Element best = doc.body();
        double bestScore = best == null ? 0 : score(best);
        for (Element el : candidates) {
            double s = score(el);
            if (s > bestScore) {
                best = el;
                bestScore = s;
            }
        }
        return best;
    }

    private double score(Element el) {
        String text = el.text();
        int textLen = text.length();
        if (textLen < 80) return 0;
        int linkLen = 0;
        for (Element a : el.select("a")) {
            linkLen += a.text().length();
        }
        double linkRatio = (double) linkLen / textLen;
        // 链接密度高 → 大概率是导航 / 列表页
        double penalty = Math.min(linkRatio * 2.0, 1.0);
        return textLen * (1.0 - penalty);
    }

    private void renderChildren(Element parent, StringBuilder out, boolean inListContext) {
        for (Node child : parent.childNodes()) {
            if (child instanceof TextNode tn) {
                String txt = tn.text();
                if (!txt.isBlank()) {
                    out.append(txt);
                }
            } else if (child instanceof Element el) {
                renderElement(el, out, inListContext);
            } else if (child instanceof Comment) {
                // 忽略
            }
        }
    }

    private void renderElement(Element el, StringBuilder out, boolean inListContext) {
        String tag = el.tagName().toLowerCase(Locale.ROOT);
        switch (tag) {
            case "h1" -> heading(el, out, "# ");
            case "h2" -> heading(el, out, "## ");
            case "h3" -> heading(el, out, "### ");
            case "h4" -> heading(el, out, "#### ");
            case "h5" -> heading(el, out, "##### ");
            case "h6" -> heading(el, out, "###### ");
            case "p" -> {
                out.append("\n\n");
                renderChildren(el, out, false);
                out.append("\n\n");
            }
            case "br" -> out.append("\n");
            case "hr" -> out.append("\n\n---\n\n");
            case "strong", "b" -> {
                out.append("**");
                renderChildren(el, out, inListContext);
                out.append("**");
            }
            case "em", "i" -> {
                out.append("*");
                renderChildren(el, out, inListContext);
                out.append("*");
            }
            case "code" -> {
                if (el.parent() != null && "pre".equalsIgnoreCase(el.parent().tagName())) {
                    renderChildren(el, out, inListContext);
                } else {
                    out.append("`").append(el.text()).append("`");
                }
            }
            case "pre" -> {
                out.append("\n\n```\n");
                out.append(el.wholeText().stripTrailing());
                out.append("\n```\n\n");
            }
            case "blockquote" -> {
                StringBuilder inner = new StringBuilder();
                renderChildren(el, inner, false);
                String[] lines = inner.toString().trim().split("\n");
                out.append("\n\n");
                for (String line : lines) {
                    out.append("> ").append(line).append("\n");
                }
                out.append("\n");
            }
            case "ul" -> renderList(el, out, false);
            case "ol" -> renderList(el, out, true);
            case "li" -> {
                // 没有外层 ul/ol（罕见）就当无序列表项处理
                out.append("\n- ");
                renderChildren(el, out, true);
            }
            case "a" -> {
                String href = el.attr("abs:href");
                String text = el.text();
                if (text.isBlank()) {
                    return;
                }
                if (href.isBlank()) {
                    out.append(text);
                } else {
                    out.append("[").append(text).append("](").append(href).append(")");
                }
            }
            case "img" -> {
                // 默认不渲染图片：会让 markdown 体积爆涨且 LLM 处理不了图片字节。如需要可在调用方扩展
                String alt = el.attr("alt");
                if (!alt.isBlank()) {
                    out.append(alt);
                }
            }
            case "table" -> renderTable(el, out);
            default -> renderChildren(el, out, inListContext);
        }
    }

    private void heading(Element el, StringBuilder out, String prefix) {
        String text = el.text().trim();
        if (text.isEmpty()) return;
        out.append("\n\n").append(prefix).append(text).append("\n\n");
    }

    private void renderList(Element list, StringBuilder out, boolean ordered) {
        out.append("\n");
        int idx = 1;
        for (Element li : list.children()) {
            if (!"li".equalsIgnoreCase(li.tagName())) continue;
            out.append(ordered ? (idx++ + ". ") : "- ");
            StringBuilder inner = new StringBuilder();
            renderChildren(li, inner, true);
            out.append(inner.toString().trim().replace("\n", " "));
            out.append("\n");
        }
        out.append("\n");
    }

    private void renderTable(Element table, StringBuilder out) {
        Elements rows = table.select("tr");
        if (rows.isEmpty()) return;
        out.append("\n\n");
        boolean headerWritten = false;
        for (Element row : rows) {
            Elements cells = row.select("th, td");
            if (cells.isEmpty()) continue;
            List<String> texts = new ArrayList<>();
            for (Element cell : cells) {
                texts.add(cell.text().replace("|", "\\|").trim());
            }
            out.append("| ").append(String.join(" | ", texts)).append(" |\n");
            if (!headerWritten) {
                out.append("|");
                for (int i = 0; i < texts.size(); i++) out.append(" --- |");
                out.append("\n");
                headerWritten = true;
            }
        }
        out.append("\n");
    }

    private String collapseBlankLines(String text) {
        return text.replaceAll("[ \\t]+\n", "\n").replaceAll("\n{3,}", "\n\n");
    }

    public record Extracted(String title, String markdown) {}
}
