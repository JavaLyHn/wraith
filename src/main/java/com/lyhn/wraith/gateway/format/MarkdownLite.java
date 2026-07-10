package com.lyhn.wraith.gateway.format;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 轻量 Markdown 解析器:把 agent 的 Markdown 回复解析成「行 × 段」中间表示(IR),
 * 供各 IM 平台按各自能力渲染(飞书 post 富文本 / QQ 纯文本清洗)。
 *
 * <p>行级:标题→整行加粗、无序列表→{@code • } 前缀、有序列表保留序号、引用去 {@code > }、
 * 代码围栏内各行标 code;连续空行折叠为一。行内:{@code **}/{@code __} 加粗、{@code *}/{@code _}
 * 斜体、反引号行内代码、{@code [t](u)} 链接、{@code \} 转义;未闭合的标记按字面输出。
 * 表格/图片等未列出的语法退化为可读文本,绝不抛异常。
 */
public final class MarkdownLite {

    /** 一段行内文本;{@code href} 非空即链接。bold/italic/code 为该段样式。 */
    public record Run(String text, boolean bold, boolean italic, boolean code, String href) {}

    /** 一行,由若干 {@link Run} 组成;{@code runs} 为空 = 空行。 */
    public record Line(List<Run> runs) {}

    private static final Pattern HEADING = Pattern.compile("^#{1,6}\\s+(.*)$");
    private static final Pattern BULLET = Pattern.compile("^\\s*[-*+]\\s+(.*)$");
    private static final Pattern ORDERED = Pattern.compile("^\\s*(\\d+)\\.\\s+(.*)$");
    private static final Pattern QUOTE = Pattern.compile("^>\\s?(.*)$");

    private MarkdownLite() {}

    /** 解析 Markdown 为行 IR;null/空 → 空列表。 */
    public static List<Line> parse(String md) {
        List<Line> lines = new ArrayList<>();
        if (md == null || md.isEmpty()) return lines;
        String norm = md.replace("\r\n", "\n").replace('\r', '\n');
        boolean inFence = false;
        boolean lastBlank = false;
        for (String raw : norm.split("\n", -1)) {
            String trimmed = raw.strip();
            if (trimmed.startsWith("```")) { // 代码围栏起止行本身丢弃
                inFence = !inFence;
                continue;
            }
            if (inFence) {
                lines.add(new Line(List.of(new Run(raw, false, false, true, null))));
                lastBlank = false;
                continue;
            }
            if (trimmed.isEmpty()) {
                // 折叠连续空行为一;跳过开头的空行(lines 为空时不加)。
                if (!lastBlank && !lines.isEmpty()) {
                    lines.add(new Line(List.of()));
                    lastBlank = true;
                }
                continue;
            }
            lastBlank = false;
            Matcher h = HEADING.matcher(raw);
            if (h.matches()) {
                lines.add(new Line(forceBold(parseInline(h.group(1)))));
                continue;
            }
            Matcher b = BULLET.matcher(raw);
            if (b.matches()) {
                List<Run> runs = new ArrayList<>();
                runs.add(new Run("• ", false, false, false, null));
                runs.addAll(parseInline(b.group(1)));
                lines.add(new Line(runs));
                continue;
            }
            Matcher o = ORDERED.matcher(raw);
            if (o.matches()) {
                List<Run> runs = new ArrayList<>();
                runs.add(new Run(o.group(1) + ". ", false, false, false, null));
                runs.addAll(parseInline(o.group(2)));
                lines.add(new Line(runs));
                continue;
            }
            Matcher q = QUOTE.matcher(raw);
            if (q.matches()) {
                lines.add(new Line(parseInline(q.group(1))));
                continue;
            }
            lines.add(new Line(parseInline(raw)));
        }
        // 去掉结尾多余空行
        while (!lines.isEmpty() && lines.get(lines.size() - 1).runs().isEmpty()) {
            lines.remove(lines.size() - 1);
        }
        return lines;
    }

    /** 把 Markdown 渲染成整洁纯文本(QQ 用):去样式标记留结构,链接→{@code 文字 (URL)}。 */
    public static String toPlainText(String md) {
        return toPlainText(parse(md));
    }

    /** 把行 IR 渲染成纯文本。 */
    public static String toPlainText(List<Line> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) sb.append('\n');
            for (Run r : lines.get(i).runs()) {
                if (r.href() != null && !r.href().isBlank() && !r.href().equals(r.text())) {
                    sb.append(r.text()).append(" (").append(r.href()).append(')');
                } else {
                    sb.append(r.text());
                }
            }
        }
        return sb.toString();
    }

    private static List<Run> forceBold(List<Run> runs) {
        List<Run> out = new ArrayList<>(runs.size());
        for (Run r : runs) out.add(new Run(r.text(), true, r.italic(), r.code(), r.href()));
        return out;
    }

    /** 行内解析入口。 */
    static List<Run> parseInline(String s) {
        return parseInline(s, false, false);
    }

    /**
     * 递归下降的行内解析:遇到有闭合的 span(加粗/斜体/代码/链接)则切出;
     * 未闭合的标记落到 buf 当字面。bold/italic 作为上下文向内层传递以支持嵌套。
     */
    private static List<Run> parseInline(String s, boolean bold, boolean italic) {
        List<Run> out = new ArrayList<>();
        StringBuilder buf = new StringBuilder();
        int i = 0;
        int n = s.length();
        while (i < n) {
            char c = s.charAt(i);
            // 转义:\* \_ \` \[ \\ → 字面下一字符
            if (c == '\\' && i + 1 < n && "*_`[\\".indexOf(s.charAt(i + 1)) >= 0) {
                buf.append(s.charAt(i + 1));
                i += 2;
                continue;
            }
            // 链接 [text](url)
            if (c == '[') {
                int close = s.indexOf(']', i + 1);
                if (close > 0 && close + 1 < n && s.charAt(close + 1) == '(') {
                    int paren = s.indexOf(')', close + 2);
                    if (paren > 0) {
                        flush(out, buf, bold, italic);
                        out.add(new Run(s.substring(i + 1, close), bold, italic, false,
                                s.substring(close + 2, paren)));
                        i = paren + 1;
                        continue;
                    }
                }
            }
            // 加粗 ** 或 __(需有闭合且内部非空,否则标记按字面)
            if ((c == '*' || c == '_') && i + 1 < n && s.charAt(i + 1) == c) {
                String delim = "" + c + c;
                int end = s.indexOf(delim, i + 2);
                if (end > i + 2) {
                    flush(out, buf, bold, italic);
                    out.addAll(parseInline(s.substring(i + 2, end), true, italic));
                    i = end + 2;
                    continue;
                }
            }
            // 斜体 * 或 _(需有闭合的单字符且内部非空)
            if (c == '*' || c == '_') {
                int end = s.indexOf(c, i + 1);
                if (end > i + 1) {
                    flush(out, buf, bold, italic);
                    out.addAll(parseInline(s.substring(i + 1, end), bold, true));
                    i = end + 1;
                    continue;
                }
            }
            // 行内代码 `x`(内部字面且非空,不再嵌套)
            if (c == '`') {
                int end = s.indexOf('`', i + 1);
                if (end > i + 1) {
                    flush(out, buf, bold, italic);
                    out.add(new Run(s.substring(i + 1, end), bold, italic, true, null));
                    i = end + 1;
                    continue;
                }
            }
            buf.append(c);
            i++;
        }
        flush(out, buf, bold, italic);
        return out;
    }

    private static void flush(List<Run> out, StringBuilder buf, boolean bold, boolean italic) {
        if (buf.length() > 0) {
            out.add(new Run(buf.toString(), bold, italic, false, null));
            buf.setLength(0);
        }
    }
}
