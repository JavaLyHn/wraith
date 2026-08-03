package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「网页抓取不了 GitHub / MDN / 维基」的守门人。
 *
 * <p><b>症状</b>：用户让 agent 抓 GitHub 仓库页，抓取本身 HTTP 200、726KB 到手，
 * 而 {@link HtmlExtractor} 只吐出 <b>361 字</b>，而且全是「Skip to content / Notifications」
 * 这类导航壳。模型看到一坨无关文本，对用户说了一句「网页抓取不了 GitHub」——
 * 一句<b>错误的事实陈述</b>，而错的根源在我们自己的提取器。
 *
 * <p><b>根因</b>：{@code cleanNoise} 拿 {@code NOISE_CLASS_KEYWORDS} 对
 * {@code class + id} 做<b>裸子串匹配</b>，命中就 {@code el.remove()} —— 连整棵子树一起删。
 * 现代页面的 class 名里到处都<b>偶然</b>含这些词：
 * <table border="1">
 *   <caption>三个真实页面的实测（用 wraith 自己的管线量的）</caption>
 *   <tr><th>页面</th><th>被删元素</th><th>命中词</th><th>占正文</th></tr>
 *   <tr><td>en.wikipedia.org</td>
 *       <td><b>{@code <html>} 本身</b>，class 含 {@code vector-feature-navigation-update-disabled}</td>
 *       <td>navigation</td><td>102%</td></tr>
 *   <tr><td>developer.mozilla.org</td>
 *       <td>{@code <div class="layout__2-sidebars-inline reference-layout">}（页面主布局）</td>
 *       <td>sidebar</td><td>99%</td></tr>
 *   <tr><td>github.com</td>
 *       <td>{@code <div class="SharedPageLayout-module__content__IwGAp" id="repos-split-pane-content">}</td>
 *       <td><b>share</b>（在 {@code Shared} 里）</td><td>99%</td></tr>
 * </table>
 * 每一次都是「把整篇正文当广告删掉」。维基那条最离谱：命中的是 {@code <html>}，
 * 于是整个文档被 remove，{@code body().text()} 归零。
 *
 * <p><b>三条修法各自独立、各有一个真实页面作证人</b>（缺一条就漏一个页面）：
 * <ol>
 *   <li>{@code html} / {@code body} 永不作为噪声删除 —— 证人：维基</li>
 *   <li>噪声词按<b>词段</b>比（按非字母数字与驼峰切开后整段相等，容许复数 s），
 *       不再裸子串 —— 证人：GitHub 的 {@code Shared}≠{@code share}</li>
 *   <li>一次删除不得吃掉正文的一半以上：占了整页的东西不是噪声，是正文，
 *       说明关键词是偶然命中 —— 证人：MDN（{@code sidebars} 确实以复数命中了 {@code sidebar}，
 *       只有这条能救它）</li>
 * </ol>
 *
 * <p>这里的 fixture 用的都是<b>真实页面上抄下来的 class 名</b>，不是我编的。
 */
class HtmlExtractorNoiseGuardTest {

    private final HtmlExtractor extractor = new HtmlExtractor();

    /** 一段够长的正文，保证过 pickMainElement 的 80 字门槛。 */
    private static final String BODY_TEXT =
            "Wraith 是一个终端 AI agent，这段正文足够长，用来确认它在噪声清理之后仍然活着。"
            + "如果这段话在提取结果里消失了，说明 cleanNoise 把整篇正文当成导航壳删掉了。";

    @Test
    @DisplayName("class 里含 Shared 的 CSS-module 容器不该被当成 share 噪声删掉 —— GitHub 正文就死在这")
    void cssModuleClassContainingSharedSurvives() {
        String html = """
                <html><body>
                  <div class="SharedPageLayout-module__content__IwGAp" id="repos-split-pane-content">
                    <p>%s</p>
                  </div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "https://github.com/o/r").markdown();
        assertTrue(md.contains("终端 AI agent"),
                "SharedPageLayout 里的 Shared 不是 share;正文被误删了: [" + md + "]");
    }

    @Test
    @DisplayName("页面主布局 class 含 sidebars（复数）时正文要留下 —— MDN 正文就死在这")
    void mainLayoutClassContainingSidebarsSurvives() {
        String html = """
                <html><body>
                  <div class="layout__2-sidebars-inline reference-layout">
                    <p>%s</p>
                  </div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "https://developer.mozilla.org/x").markdown();
        assertTrue(md.contains("终端 AI agent"),
                "占了整页的东西不是噪声;正文被误删了: [" + md + "]");
    }

    @Test
    @DisplayName("<html> 的 class 含 navigation 时不能把整个文档删掉 —— 维基百科提取出 0 字就是这条")
    void htmlElementIsNeverRemovedAsNoise() {
        String html = """
                <html class="client-nojs vector-feature-navigation-update-disabled vector-toc-available">
                <body>
                  <div><p>%s</p></div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "https://en.wikipedia.org/wiki/X").markdown();
        assertTrue(md.contains("终端 AI agent"),
                "命中的是 <html>,整篇文档被 remove 了: [" + md + "]");
    }

    @Test
    @DisplayName("body 上挂了噪声 class 也一样不能删")
    void bodyElementIsNeverRemovedAsNoise() {
        String html = """
                <html><body class="page with-sidebar">
                  <div><p>%s</p></div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "").markdown();
        assertTrue(md.contains("终端 AI agent"), "body 被当噪声删了: [" + md + "]");
    }

    @Test
    @DisplayName("真·小块噪声还是要删掉 —— 修法不能把噪声清理本身废掉")
    void genuineSmallNoiseBlocksAreStillRemoved() {
        String html = """
                <html><body>
                  <div class="sidebar"><a href="/a">侧栏链接甲</a><a href="/b">侧栏链接乙</a></div>
                  <div class="post-comments"><p>楼下沙发评论区的一句废话</p></div>
                  <div class="cookie-banner"><p>本站使用 Cookie</p></div>
                  <div id="content"><p>%s</p></div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "").markdown();
        assertTrue(md.contains("终端 AI agent"), "正文该留下: [" + md + "]");
        assertFalse(md.contains("侧栏链接甲"), "class=sidebar 该删: [" + md + "]");
        assertFalse(md.contains("沙发评论区"), "post-comments 该删(复数也算命中): [" + md + "]");
        assertFalse(md.contains("使用 Cookie"), "cookie-banner 该删: [" + md + "]");
    }

    @Test
    @DisplayName("词段相等才算命中:advertise 里的 ads、sharepoint 里的 share 都不算")
    void keywordMatchesWholeSegmentsOnly() {
        String html = """
                <html><body>
                  <div class="sharepoint-embed"><p>%s</p></div>
                </body></html>
                """.formatted(BODY_TEXT);
        String md = extractor.extract(html, "").markdown();
        assertTrue(md.contains("终端 AI agent"), "sharepoint 不是 share: [" + md + "]");
    }
}
