package com.lyhn.wraith.gateway.format;

import com.lyhn.wraith.gateway.format.MarkdownLite.Line;
import com.lyhn.wraith.gateway.format.MarkdownLite.Run;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MarkdownLiteTest {

    // ── 行内:加粗 / 斜体 / 代码 / 链接 ──────────────────────────────

    @Test
    void boldRunAcrossStarStarAndUnderscore() {
        for (String md : new String[]{"我是 **Wraith CLI** 呀", "我是 __Wraith CLI__ 呀"}) {
            List<Run> runs = onlyLine(MarkdownLite.parse(md));
            assertEquals(3, runs.size(), md);
            assertEquals("我是 ", runs.get(0).text());
            assertFalse(runs.get(0).bold());
            assertEquals("Wraith CLI", runs.get(1).text());
            assertTrue(runs.get(1).bold(), "中段应加粗: " + md);
            assertEquals(" 呀", runs.get(2).text());
        }
    }

    @Test
    void italicRun() {
        List<Run> runs = onlyLine(MarkdownLite.parse("说 *轻声* 话"));
        assertEquals("轻声", runs.get(1).text());
        assertTrue(runs.get(1).italic());
        assertFalse(runs.get(1).bold());
    }

    @Test
    void inlineCodeStripsBackticksAndMarksCode() {
        List<Run> runs = onlyLine(MarkdownLite.parse("跑 `mvn test` 试试"));
        assertEquals("mvn test", runs.get(1).text());
        assertTrue(runs.get(1).code());
    }

    @Test
    void linkCarriesTextAndHref() {
        List<Run> runs = onlyLine(MarkdownLite.parse("见 [文档](https://x.y/z) 说明"));
        Run link = runs.get(1);
        assertEquals("文档", link.text());
        assertEquals("https://x.y/z", link.href());
    }

    @Test
    void nestedLinkInsideBold() {
        List<Run> runs = onlyLine(MarkdownLite.parse("**见 [文档](https://x.y)**"));
        // 至少有一段是既加粗又是链接
        assertTrue(runs.stream().anyMatch(r -> r.bold() && "https://x.y".equals(r.href())),
                "加粗内的链接应同时带 bold 与 href");
    }

    @Test
    void unclosedMarkersStayLiteral() {
        List<Run> runs = onlyLine(MarkdownLite.parse("价格是 **5 星"));
        String flat = flat(runs);
        assertEquals("价格是 **5 星", flat, "未闭合的 ** 应按字面保留");
        assertTrue(runs.stream().noneMatch(Run::bold));
    }

    @Test
    void escapedMarkersBecomeLiteral() {
        List<Run> runs = onlyLine(MarkdownLite.parse("字面 \\*星号\\* 和 \\`反引号\\`"));
        assertEquals("字面 *星号* 和 `反引号`", flat(runs));
        assertTrue(runs.stream().noneMatch(r -> r.italic() || r.code()));
    }

    // ── 行级:标题 / 列表 / 引用 / 代码围栏 / 空行 ────────────────────

    @Test
    void headingBecomesBoldLineWithoutHashes() {
        List<Run> runs = onlyLine(MarkdownLite.parse("## 标题在此"));
        assertEquals("标题在此", flat(runs));
        assertTrue(runs.stream().allMatch(Run::bold), "标题整行应加粗");
    }

    @Test
    void bulletGetsDotPrefix() {
        List<Line> lines = MarkdownLite.parse("- 第一项\n* 第二项\n+ 第三项");
        assertEquals(3, lines.size());
        for (Line l : lines) assertTrue(flat(l.runs()).startsWith("• "), "无序列表应有 • 前缀");
        assertTrue(flat(lines.get(0).runs()).contains("第一项"));
    }

    @Test
    void orderedListKeepsNumber() {
        List<Run> runs = onlyLine(MarkdownLite.parse("1. 首步"));
        assertEquals("1. 首步", flat(runs));
    }

    @Test
    void blockquoteStripsMarker() {
        List<Run> runs = onlyLine(MarkdownLite.parse("> 引用一句"));
        assertEquals("引用一句", flat(runs));
    }

    @Test
    void fencedCodeLinesMarkedCodeAndFenceDropped() {
        List<Line> lines = MarkdownLite.parse("```java\nSystem.out.println(1);\n```");
        assertEquals(1, lines.size(), "围栏起止行应被丢弃,只剩内部一行");
        Run r = lines.get(0).runs().get(0);
        assertEquals("System.out.println(1);", r.text());
        assertTrue(r.code());
    }

    @Test
    void consecutiveBlankLinesFoldToOne() {
        List<Line> lines = MarkdownLite.parse("第一段\n\n\n\n第二段");
        assertEquals(3, lines.size(), "多空行折叠为一个空行");
        assertTrue(lines.get(1).runs().isEmpty(), "中间是一个空行");
    }

    @Test
    void leadingAndTrailingBlanksTrimmed() {
        List<Line> lines = MarkdownLite.parse("\n\n正文\n\n");
        assertEquals(1, lines.size());
        assertEquals("正文", flat(lines.get(0).runs()));
    }

    @Test
    void nullAndEmptyGiveEmptyList() {
        assertTrue(MarkdownLite.parse(null).isEmpty());
        assertTrue(MarkdownLite.parse("").isEmpty());
    }

    // ── toPlainText(QQ 用)──────────────────────────────────────────

    @Test
    void plainTextStripsEmphasisMarks() {
        assertEquals("我是 Wraith CLI,对标 Claude Code。",
                MarkdownLite.toPlainText("我是 **Wraith CLI**,对标 `Claude Code`。"));
    }

    @Test
    void plainTextRendersLinkAsTextWithUrl() {
        assertEquals("见 文档 (https://x.y) 说明",
                MarkdownLite.toPlainText("见 [文档](https://x.y) 说明"));
    }

    @Test
    void plainTextLinkWhereTextEqualsUrlNotDuplicated() {
        assertEquals("https://x.y",
                MarkdownLite.toPlainText("[https://x.y](https://x.y)"));
    }

    @Test
    void plainTextMultiLineWithBulletsAndBlank() {
        String out = MarkdownLite.toPlainText("# 能力\n\n- **构建**\n- 测试");
        assertEquals("能力\n\n• 构建\n• 测试", out);
    }

    // ── helpers ─────────────────────────────────────────────────────

    private static List<Run> onlyLine(List<Line> lines) {
        assertEquals(1, lines.size(), "期望单行");
        return lines.get(0).runs();
    }

    private static String flat(List<Run> runs) {
        StringBuilder sb = new StringBuilder();
        for (Run r : runs) sb.append(r.text());
        return sb.toString();
    }
}
