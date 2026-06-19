package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.util.AnsiStyle;
import org.jline.terminal.Attributes;
import org.jline.terminal.Terminal;

import java.io.PrintStream;
import java.util.List;

/**
 * 临时浮起的命令选择列表。
 *
 * <p>渲染策略(参考 {@link com.lyhn.wraith.render.intro.IntroAnimation}):先用换行
 * <b>预留</b> H 行画布(只在当前滚动区内向上滚出空间),随后每次重绘都「回到画布顶端 +
 * 逐行 {@code CLEAR_LINE} 就地重画」。<b>绝不</b>使用清到屏幕底部的 {@code ESC[J}——
 * 那会抹掉常驻在底部的状态栏 / 输入框 dock,导致它被重画到错位处(往下滑)。结束时只精确
 * 清掉这 H 行,光标停回画布顶端,供调用方接着打印。
 *
 * <p>不支持光标动画 / 模糊搜索(留作后续增强)。
 */
public final class SlashPalette {

    private final PrintStream out;
    private final Terminal terminal;

    public SlashPalette(PrintStream out, Terminal terminal) {
        this.out = out;
        this.terminal = terminal;
    }

    /**
     * 打开 palette,阻塞等待用户选择。
     *
     * @return 选中项的下标;用户取消(Esc)返回 -1
     */
    public int open(String title, List<String> items) {
        if (items == null || items.isEmpty()) {
            return -1;
        }
        int selected = 0;
        int h = items.size() + 2; // 标题 + N 项 + 底部提示
        boolean reserved = false;
        try {
            reserveSpace(h);
            reserved = true;
            while (true) {
                draw(title, items, selected, h);
                int key = readKey();
                int decision = handleKey(key, selected, items.size());
                if (decision == DECISION_CANCEL) {
                    return -1;
                }
                if (decision == DECISION_CONFIRM) {
                    return selected;
                }
                if (decision >= 0 && decision < items.size()) {
                    return decision; // 数字快捷键直接选定
                }
                if (decision == DECISION_UP) {
                    selected = (selected - 1 + items.size()) % items.size();
                } else if (decision == DECISION_DOWN) {
                    selected = (selected + 1) % items.size();
                }
            }
        } finally {
            if (reserved) {
                clearBlock(h);
            }
        }
    }

    /** 预留 H 行画布:从当前光标向下滚出 H 行(在当前滚动区内滚动,不触及下方 dock)。 */
    private void reserveSpace(int h) {
        synchronized (out) {
            for (int i = 0; i < h; i++) {
                out.print("\r\n");
            }
            out.flush();
        }
    }

    /** 回到画布顶端,逐行就地重绘(每行先 CLEAR_LINE);不向屏幕底部清除,故不动 dock。 */
    private void draw(String title, List<String> items, int selected, int h) {
        int cols = Math.max(20, safeWidth());
        synchronized (out) {
            out.print(AnsiSeq.moveUp(h));
            out.print("\r");
            drawLine(AnsiStyle.heading(fit("┌─ " + (title == null ? "选择" : title) + " ─", cols)));
            for (int i = 0; i < items.size(); i++) {
                String prefix = (i == selected) ? "▶ " : "  ";
                String numberHint = i < 9 ? "[" + (i + 1) + "] " : "    ";
                String line = fit("│ " + prefix + numberHint + items.get(i), cols);
                drawLine(i == selected ? AnsiStyle.emphasis(line) : line);
            }
            drawLine(AnsiStyle.subtle(fit("└─ ↑↓ 切换  Enter 确认  Esc 取消  数字键直选", cols)));
            out.flush();
        }
    }

    private void drawLine(String styled) {
        out.print(AnsiSeq.CLEAR_LINE);
        out.print(styled);
        out.print("\r\n");
    }

    /** 精确清掉 H 行画布,光标停回画布顶端;只清这 H 行,绝不向屏幕底部清除。 */
    private void clearBlock(int h) {
        synchronized (out) {
            out.print(AnsiSeq.moveUp(h));
            out.print("\r");
            for (int r = 0; r < h; r++) {
                out.print(AnsiSeq.CLEAR_LINE);
                if (r < h - 1) {
                    out.print("\n");
                }
            }
            out.print(AnsiSeq.moveUp(h - 1));
            out.print("\r");
            out.flush();
        }
    }

    private int safeWidth() {
        try {
            int w = terminal.getWidth();
            return w > 0 ? w : 80;
        } catch (Exception e) {
            return 80;
        }
    }

    /** 按显示宽度截断,避免行回绕打乱画布行数(CJK 记 2 宽)。 */
    static String fit(String s, int cols) {
        int budget = Math.max(1, cols - 1);
        int width = 0;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            int w = isWide(cp) ? 2 : 1;
            if (width + w > budget) {
                break;
            }
            sb.appendCodePoint(cp);
            width += w;
            i += Character.charCount(cp);
        }
        return sb.toString();
    }

    private static boolean isWide(int cp) {
        Character.UnicodeBlock b = Character.UnicodeBlock.of(cp);
        return b == Character.UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS
                || b == Character.UnicodeBlock.CJK_SYMBOLS_AND_PUNCTUATION
                || b == Character.UnicodeBlock.HALFWIDTH_AND_FULLWIDTH_FORMS
                || b == Character.UnicodeBlock.HIRAGANA
                || b == Character.UnicodeBlock.KATAKANA;
    }

    private int readKey() {
        Attributes original;
        try {
            original = terminal.enterRawMode();
        } catch (Exception e) {
            return -1;
        }
        try {
            terminal.flush();
            int b = terminal.reader().read();
            if (b == 27) {
                // ESC 或 ESC + 控制序列
                int next = terminal.reader().read(50);
                if (next < 0) return KEY_ESC;
                if (next == '[') {
                    int third = terminal.reader().read(50);
                    return switch (third) {
                        case 'A' -> KEY_UP;
                        case 'B' -> KEY_DOWN;
                        default -> KEY_ESC;
                    };
                }
                return KEY_ESC;
            }
            return b;
        } catch (Exception e) {
            return -1;
        } finally {
            try {
                terminal.setAttributes(original);
            } catch (Exception ignored) {
            }
        }
    }

    private static final int KEY_ESC = -2;
    private static final int KEY_UP = -3;
    private static final int KEY_DOWN = -4;

    private static final int DECISION_CANCEL = -1;
    private static final int DECISION_CONFIRM = -2;
    private static final int DECISION_UP = -3;
    private static final int DECISION_DOWN = -4;
    private static final int DECISION_NONE = -5;

    static int handleKey(int key, int selected, int itemCount) {
        if (key == KEY_UP) {
            return DECISION_UP;
        }
        if (key == KEY_DOWN) {
            return DECISION_DOWN;
        }
        if (key == KEY_ESC || key < 0) {
            return DECISION_CANCEL;
        }
        if (key == '\r' || key == '\n') {
            return DECISION_CONFIRM;
        }
        if (key >= '1' && key <= '9') {
            int idx = key - '1';
            if (idx < itemCount) {
                return idx;
            }
        }
        if (key == 'k' || key == 'K') return DECISION_UP;
        if (key == 'j' || key == 'J') return DECISION_DOWN;
        if (key == 'q' || key == 'Q') return DECISION_CANCEL;
        return DECISION_NONE;
    }
}
