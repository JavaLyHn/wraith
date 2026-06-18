package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.util.AnsiStyle;

import java.util.ArrayList;
import java.util.List;

/**
 * 常驻顶部固定区的 WRAITH banner 内容(字标 + 信息行)。
 *
 * <p>内容行(已上色)固定不变;分隔线随列宽自适应,每次 {@link #lines(int)} 按当前列宽重新生成。
 * {@link #height()} 给出固定区总行数,供滚动区计算保留多少顶部行。纯逻辑、不触终端,便于单测。
 */
public final class PinnedBanner {

    private final List<String> content;

    public PinnedBanner(List<String> content) {
        this.content = content == null ? List.of() : List.copyOf(content);
    }

    /** 固定区总高度(行)= 内容行数 + 1 条分隔线。 */
    public int height() {
        return content.size() + 1;
    }

    /** 按列宽渲染:内容行原样 + 末行整宽分隔线(暗灰)。 */
    public List<String> lines(int cols) {
        List<String> out = new ArrayList<>(content);
        out.add(AnsiStyle.rule("─".repeat(Math.max(1, cols))));
        return out;
    }

    boolean isEmpty() {
        return content.isEmpty();
    }
}
