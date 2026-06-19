package com.lyhn.wraith.render.inline;

import java.util.List;

/**
 * 顶部常驻 WRAITH 标识(2 行):
 * <ul>
 *   <li>第 1 行:{@code ▌ WRAITH · v<version> · <model>},按列宽截断;</li>
 *   <li>第 2 行:整宽细分隔线 {@code ─}。</li>
 * </ul>
 * {@link #render(int, String, String)} 是纯函数(无 ANSI),便于单测;颜色与绘制由 InlineRenderer 负责。
 */
public final class TopHeader {

    private TopHeader() {
    }

    /** 顶栏高度(行)。 */
    public static final int HEIGHT = 2;

    /** 2 行原始字符(无 ANSI),每行列宽 ≤ cols。 */
    public static List<String> render(int cols, String version, String model) {
        int w = Math.max(1, cols);
        StringBuilder line1 = new StringBuilder("▌ WRAITH");
        if (version != null && !version.isBlank()) {
            line1.append("  ·  v").append(version.trim());
        }
        if (model != null && !model.isBlank()) {
            line1.append("  ·  ").append(model.trim());
        }
        return List.of(truncate(line1.toString(), w), "─".repeat(w));
    }

    private static String truncate(String s, int w) {
        if (s.length() <= w) {
            return s;
        }
        if (w <= 1) {
            return s.substring(0, w);
        }
        return s.substring(0, w - 1) + "…";
    }
}
