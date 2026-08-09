package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.util.AnsiStyle;
import org.jline.terminal.Attributes;
import org.jline.terminal.Terminal;

import java.io.PrintStream;
import java.util.List;

/**
 * 通用交互式选择器:方向键导航 + 数字键直选。
 *
 * <p>基于 {@link SlashPalette} 的渲染策略增强,支持 {@link ChoiceOption} 的 description。
 * 所有需要用户做选择的场景统一通过 {@link com.lyhn.wraith.render.Renderer#promptChoice} 调到这里。
 *
 * <p>渲染策略与 SlashPalette 一致:预留 H 行画布,逐行 CLEAR_LINE 就地重画,
 * 不用 ESC[J 清屏底(会抹掉底部 dock)。结束时精确清掉 H 行。
 */
public final class InteractiveSelector {

    private final PrintStream out;
    private final Terminal terminal;

    public InteractiveSelector(PrintStream out, Terminal terminal) {
        this.out = out;
        this.terminal = terminal;
    }

    /**
     * 打开选择器,阻塞等待用户选择。
     *
     * @return 用户选择结果;取消时 cancelled=true
     */
    public ChoiceResult open(ChoiceRequest request) {
        if (request == null || request.options() == null || request.options().isEmpty()) {
            return ChoiceResult.cancelled();
        }
        List<ChoiceOption> items = request.options();
        int selected = 0;
        int h = calculateHeight(items);
        boolean reserved = false;
        try {
            reserveSpace(h);
            reserved = true;
            while (true) {
                draw(request.title(), items, selected, h, request.hint(), request.allowCancel());
                int key = readKey();
                int decision = handleKey(key, selected, items.size());
                if (decision == DECISION_CANCEL) {
                    return ChoiceResult.cancelled();
                }
                if (decision == DECISION_CONFIRM) {
                    return ChoiceResult.selected(selected);
                }
                if (decision >= 0 && decision < items.size()) {
                    return ChoiceResult.selected(decision);
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

    /** 计算画布高度:标题 + 每项(label 行 + 可选 description 行) + 底部提示。 */
    private int calculateHeight(List<ChoiceOption> items) {
        int h = 1; // 标题
        for (ChoiceOption opt : items) {
            h++; // label 行
            if (opt.description() != null && !opt.description().isBlank()) {
                h++; // description 行
            }
        }
        h++; // 底部提示
        return h;
    }

    private void reserveSpace(int h) {
        synchronized (out) {
            for (int i = 0; i < h; i++) {
                out.print("\r\n");
            }
            out.flush();
        }
    }

    private void draw(String title, List<ChoiceOption> items, int selected, int h, String hint, boolean allowCancel) {
        int cols = Math.max(20, safeWidth());
        synchronized (out) {
            out.print(AnsiSeq.moveUp(h));
            out.print("\r");
            drawLine(AnsiStyle.heading(fit("┌─ " + (title == null ? "选择" : title) + " ─", cols)));
            for (int i = 0; i < items.size(); i++) {
                String prefix = (i == selected) ? "▶ " : "  ";
                String numberHint = i < 9 ? "[" + (i + 1) + "] " : "    ";
                String label = items.get(i).label();
                String labelLine = fit("│ " + prefix + numberHint + label, cols);
                drawLine(i == selected ? AnsiStyle.emphasis(labelLine) : labelLine);
                // 有 description 时在 label 下方浅色显示
                String desc = items.get(i).description();
                if (desc != null && !desc.isBlank()) {
                    String descLine = fit("│      " + desc, cols);
                    drawLine(AnsiStyle.subtle(descLine));
                }
            }
            String defaultHint = allowCancel
                    ? "└─ ↑↓ 切换  Enter 确认  Esc 取消  数字键直选"
                    : "└─ ↑↓ 切换  Enter 确认  数字键直选";
            drawLine(AnsiStyle.subtle(fit(hint != null ? hint : defaultHint, cols)));
            out.flush();
        }
    }

    private void drawLine(String styled) {
        out.print(AnsiSeq.CLEAR_LINE);
        out.print(styled);
        out.print("\r\n");
    }

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

    /** 计算字符串的终端显示宽度。 */
    static int displayWidth(String s) {
        if (s == null) return 0;
        int w = 0;
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            w += isWide(cp) ? 2 : 1;
            i += Character.charCount(cp);
        }
        return w;
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
        if (terminal == null) {
            return -1;
        }
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

    static final int KEY_ESC = -2;
    static final int KEY_UP = -3;
    static final int KEY_DOWN = -4;

    static final int DECISION_CANCEL = -1;
    static final int DECISION_CONFIRM = -2;
    static final int DECISION_UP = -3;
    static final int DECISION_DOWN = -4;
    static final int DECISION_NONE = -5;

    static int handleKey(int key, int selected, int itemCount) {
        if (key == KEY_UP) return DECISION_UP;
        if (key == KEY_DOWN) return DECISION_DOWN;
        if (key == KEY_ESC || key < 0) return DECISION_CANCEL;
        if (key == '\r' || key == '\n') return DECISION_CONFIRM;
        if (key >= '1' && key <= '9') {
            int idx = key - '1';
            if (idx < itemCount) return idx;
        }
        if (key == 'k' || key == 'K') return DECISION_UP;
        if (key == 'j' || key == 'J') return DECISION_DOWN;
        if (key == 'q' || key == 'Q') return DECISION_CANCEL;
        return DECISION_NONE;
    }
}
