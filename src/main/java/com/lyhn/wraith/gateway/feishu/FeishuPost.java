package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.gateway.format.MarkdownLite;

import java.util.List;

/**
 * 把 {@link MarkdownLite} 的行 IR 渲染成飞书 {@code msg_type=post} 富文本 content JSON。
 * wire 外形:{@code {"zh_cn":{"title":"","content":[ <每行一个段数组> ]}}};text 段可带
 * {@code "style":["bold"|"italic"]},链接段为 {@code {"tag":"a","text":..,"href":..}}。
 *
 * <p>用 Jackson 序列化(与 {@link FeishuApproval} 同一套 {@link ObjectMapper}),转义交给库,
 * 规避 SDK {@code MessageText} 裸拼致 code=230001 的坑。飞书 post 每行至少要有一个段:
 * 空行渲染为一个空 text 段。code 样式 post 无内联对应 → 退化为普通 text 段。
 */
public final class FeishuPost {

    private static final ObjectMapper M = new ObjectMapper();

    private FeishuPost() {}

    /** 行 IR → post content JSON 字符串。null/空 → 单个空行,保证 content 合法非空。 */
    public static String contentJson(List<MarkdownLite.Line> lines) {
        ObjectNode root = M.createObjectNode();
        ObjectNode zh = root.putObject("zh_cn");
        zh.put("title", "");
        ArrayNode content = zh.putArray("content");

        List<MarkdownLite.Line> ls = (lines == null || lines.isEmpty())
                ? List.of(new MarkdownLite.Line(List.of()))
                : lines;

        for (MarkdownLite.Line line : ls) {
            ArrayNode seg = content.addArray();
            if (line.runs().isEmpty()) {
                ObjectNode t = seg.addObject();
                t.put("tag", "text");
                t.put("text", "");
                continue;
            }
            for (MarkdownLite.Run r : line.runs()) {
                ObjectNode node = seg.addObject();
                if (r.href() != null && !r.href().isBlank()) {
                    node.put("tag", "a");
                    node.put("text", r.text());
                    node.put("href", r.href());
                } else {
                    node.put("tag", "text");
                    node.put("text", r.text());
                    if (r.bold() || r.italic()) {
                        ArrayNode style = node.putArray("style");
                        if (r.bold()) style.add("bold");
                        if (r.italic()) style.add("italic");
                    }
                }
            }
        }

        try {
            return M.writeValueAsString(root);
        } catch (Exception e) {
            // ObjectNode 序列化不会失败;兜底返回极简合法 post 防 NPE。
            return "{\"zh_cn\":{\"title\":\"\",\"content\":[[{\"tag\":\"text\",\"text\":\"\"}]]}}";
        }
    }

    /** 便捷重载:直接从 Markdown 原文生成 post content JSON。 */
    public static String contentJson(String markdown) {
        return contentJson(MarkdownLite.parse(markdown));
    }
}
