package com.lyhn.wraith.tool;

import com.lyhn.wraith.web.FetchResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code web_fetch} 递给模型的那段文本。
 *
 * <p>诊断逻辑本身在 {@code FetchDiagnosisTest} 里；这里守的是<b>接线</b>：
 * 诊断有没有真的出现在回包里、位置对不对（必须在正文<b>之前</b>——
 * 塞在 50KB 正文后面的警告等于没写）。
 */
class FetchResultFormattingTest {

    @Test
    @DisplayName("正文极少时,警告出现在正文之前")
    void thinBodyWarningComesBeforeTheContent() {
        FetchResult r = FetchResult.ok("https://example.com/spa", "某 SPA", "只有这么一点导航文字", 20, false);
        String out = ToolRegistry.formatFetchResult(r, 640_000);
        assertTrue(out.contains("抓取本身是成功的"), out);
        int warn = out.indexOf("抓取本身是成功的");
        int body = out.indexOf("只有这么一点导航文字");
        assertTrue(warn >= 0 && body >= 0 && warn < body,
                "警告必须在正文之前,否则模型读到的顺序是「一坨无关文本 → 警告」: " + out);
    }

    @Test
    @DisplayName("GitHub 的纯文本入口出现在回包里")
    void githubRouteIsIncluded() {
        String md = "x".repeat(30_000);
        FetchResult r = FetchResult.ok("https://github.com/o/r/blob/main/pom.xml", "pom", md, 30_000, false);
        String out = ToolRegistry.formatFetchResult(r, 600_000);
        assertTrue(out.contains("raw.githubusercontent.com/o/r/main/pom.xml"), "该给 raw 入口");
        assertFalse(out.contains("抓取本身是成功的"), "正文正常,不该报「只提取到几字」");
    }

    @Test
    @DisplayName("普通页面回包不变:没有多余的一行")
    void normalPageIsUnchanged() {
        String md = "正文".repeat(5_000);
        FetchResult r = FetchResult.ok("https://example.com/post", "标题", md, 10_000, false);
        String out = ToolRegistry.formatFetchResult(r, 200_000);
        assertTrue(out.contains("📏 正文 10000 字符"), out);
        assertFalse(out.contains("⚠️"), "普通页面不该有警告: " + out.substring(0, Math.min(200, out.length())));
    }

    @Test
    @DisplayName("完全没提取到正文时,原有的「未提取到正文」还在,且不会重复报一遍抓取成功")
    void emptyBodyKeepsItsOwnHint() {
        FetchResult r = FetchResult.ok("https://github.com/o/r/tree/main", "空", "", 0, false);
        String out = ToolRegistry.formatFetchResult(r, 640_000);
        assertTrue(out.contains("未提取到正文"), out);
        assertFalse(out.contains("抓取本身是成功的"), "空正文归原 hint 说,别两句话打架: " + out);
        assertTrue(out.contains("api.github.com/repos/o/r/contents"), "空正文时更该给替代路线: " + out);
    }
}
