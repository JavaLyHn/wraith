package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.gateway.format.MarkdownLite;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FeishuPostTest {

    private static final ObjectMapper M = new ObjectMapper();

    private JsonNode content(String markdown) throws Exception {
        String json = FeishuPost.contentJson(MarkdownLite.parse(markdown));
        JsonNode root = M.readTree(json); // 非法 JSON 会在此抛出
        JsonNode content = root.path("zh_cn").path("content");
        assertTrue(content.isArray(), "content 应为数组");
        return content;
    }

    @Test
    void wireShapeHasZhCnTitleAndContent() throws Exception {
        JsonNode root = M.readTree(FeishuPost.contentJson(MarkdownLite.parse("你好")));
        assertTrue(root.has("zh_cn"));
        assertEquals("", root.path("zh_cn").path("title").asText());
        assertTrue(root.path("zh_cn").path("content").isArray());
    }

    @Test
    void boldRunGetsBoldStyle() throws Exception {
        // 行[0] 的段里应有一个 text 段 style 含 bold,text=Wraith CLI
        JsonNode line0 = content("我是 **Wraith CLI** 呀").get(0);
        JsonNode boldSeg = null;
        for (JsonNode seg : line0) {
            if ("Wraith CLI".equals(seg.path("text").asText())) boldSeg = seg;
        }
        assertNotNull(boldSeg, "应有 text=Wraith CLI 的段");
        assertEquals("text", boldSeg.path("tag").asText());
        assertTrue(styleContains(boldSeg, "bold"), "该段 style 应含 bold");
    }

    @Test
    void italicRunGetsItalicStyle() throws Exception {
        JsonNode line0 = content("说 *轻声* 话").get(0);
        boolean found = false;
        for (JsonNode seg : line0) {
            if ("轻声".equals(seg.path("text").asText())) {
                assertTrue(styleContains(seg, "italic"));
                found = true;
            }
        }
        assertTrue(found);
    }

    @Test
    void linkRunIsAnchorTagWithHref() throws Exception {
        JsonNode line0 = content("见 [文档](https://x.y/z) 说明").get(0);
        JsonNode a = null;
        for (JsonNode seg : line0) if ("a".equals(seg.path("tag").asText())) a = seg;
        assertNotNull(a, "应有 tag=a 的链接段");
        assertEquals("文档", a.path("text").asText());
        assertEquals("https://x.y/z", a.path("href").asText());
    }

    @Test
    void blankLineRendersAsEmptyTextSegment() throws Exception {
        JsonNode c = content("第一段\n\n第二段");
        assertEquals(3, c.size(), "首段 / 空行 / 次段");
        JsonNode blank = c.get(1);
        assertEquals(1, blank.size());
        assertEquals("", blank.get(0).path("text").asText());
        assertEquals("text", blank.get(0).path("tag").asText());
    }

    @Test
    void everyLineHasAtLeastOneSegment() throws Exception {
        JsonNode c = content("a\n\n\nb");
        for (JsonNode line : c) assertTrue(line.size() >= 1, "post 每行至少一个段");
    }

    @Test
    void specialCharsEscapedAndValidJson() throws Exception {
        // 含引号/换行/反斜杠:必须拼成合法 JSON 且文本无损(回归 code=230001)
        JsonNode c = content("第一行带\"引号\"和\\反斜杠\n第二行");
        assertEquals(2, c.size());
        String first = c.get(0).get(0).path("text").asText();
        assertEquals("第一行带\"引号\"和\\反斜杠", first, "引号/反斜杠应无损还原");
    }

    @Test
    void nullAndEmptyGiveValidNonEmptyContent() throws Exception {
        for (String s : new String[]{null, ""}) {
            JsonNode root = M.readTree(FeishuPost.contentJson(MarkdownLite.parse(s)));
            JsonNode c = root.path("zh_cn").path("content");
            assertTrue(c.isArray() && c.size() >= 1, "空输入也要给合法非空 content: " + s);
            assertTrue(c.get(0).size() >= 1);
        }
    }

    private static boolean styleContains(JsonNode seg, String style) {
        JsonNode arr = seg.path("style");
        if (!arr.isArray()) return false;
        for (JsonNode s : arr) if (style.equals(s.asText())) return true;
        return false;
    }
}
