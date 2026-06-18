package com.lyhn.wraith.render.intro;

import com.lyhn.wraith.render.WraithWordmark;

import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

import org.jline.terminal.Attributes;
import org.jline.terminal.Terminal;
import org.jline.utils.NonBlockingReader;

/**
 * 黑底纯白的 WRAITH 开场动画(三段式):扫描线自上而下并从中间裂开 → 扫描线溶解、
 * 字标自左向右显现 → 整块字标左右摆动后回正。终端无真 alpha,fade 用密度字符近似。
 *
 * <p>{@link #frames(int)} 是纯函数(给定列宽生成逐帧字符,不含 ANSI),便于单测;
 * {@link #play(Terminal)} 负责真实 I/O、节奏与按键跳过。
 */
public final class IntroAnimation {

    private IntroAnimation() {
    }

    private static final String ESC = String.valueOf((char) 27);
    private static final String WHITE = ESC + "[1;97m";
    private static final String RESET = ESC + "[0m";
    private static final String HIDE_CURSOR = ESC + "[?25l";
    private static final String SHOW_CURSOR = ESC + "[?25h";
    private static final int FRAME_MS = 38;
    private static final int REVEAL_STEPS = 12;
    private static final int SPLIT_FRAMES = 6;
    private static final int[] SWAY = {2, 1, 0, -1, -2, -1, 0, 1, 0};

    /** 逐帧画面;每帧是 height() 行的原始字符(无 ANSI),每行列宽 ≤ cols。空字符串表示空行。 */
    public static List<List<String>> frames(int cols) {
        int w = Math.max(1, cols);
        List<String> art = WraithWordmark.LINES;
        int h = WraithWordmark.height();
        int width = WraithWordmark.width();
        List<List<String>> frames = new ArrayList<>();
        if (width + 2 > w) {
            return frames; // 太窄:不出帧(IntroGate 一般已拦住)
        }
        int basePad = (w - width) / 2;
        int mid = h / 2;

        // 1) 扫描线自上而下,带一行变暗的拖尾
        for (int pos = 0; pos <= h; pos++) {
            List<String> f = blank(h);
            if (pos < h) {
                f.set(pos, repeat('█', w));
            }
            if (pos - 1 >= 0 && pos - 1 < h) {
                f.set(pos - 1, repeat('▒', w));
            }
            frames.add(f);
        }
        // 1b) 中线裂开,两半向两侧退去(中间空隙逐渐变满)
        for (int i = 1; i <= SPLIT_FRAMES; i++) {
            int gap = (int) ((double) i / SPLIT_FRAMES * w);
            int half = Math.max(0, (w - gap) / 2);
            List<String> f = blank(h);
            if (half > 0) {
                f.set(mid, repeat('█', half) + repeat(' ', w - 2 * half) + repeat('█', half));
            }
            frames.add(f);
        }
        // 2) 字标自左向右逐列显现
        for (int s = 1; s <= REVEAL_STEPS; s++) {
            int reveal = (int) Math.ceil(width * (double) s / REVEAL_STEPS);
            frames.add(reveal(art, basePad, Math.min(reveal, width)));
        }
        // 3) 左右摆动后回正(末帧 = 居中字标)
        for (int off : SWAY) {
            frames.add(sway(art, basePad, off, width, w));
        }
        return frames;
    }

    private static List<String> blank(int h) {
        List<String> rows = new ArrayList<>(h);
        for (int i = 0; i < h; i++) {
            rows.add("");
        }
        return rows;
    }

    private static List<String> reveal(List<String> art, int basePad, int revealCols) {
        List<String> rows = new ArrayList<>(art.size());
        String pad = repeat(' ', basePad);
        for (String line : art) {
            int n = Math.min(revealCols, line.length());
            rows.add(n <= 0 ? "" : pad + line.substring(0, n));
        }
        return rows;
    }

    private static List<String> sway(List<String> art, int basePad, int off, int width, int w) {
        int leftPad = Math.max(0, Math.min(basePad + off, w - width));
        List<String> rows = new ArrayList<>(art.size());
        String pad = repeat(' ', leftPad);
        for (String line : art) {
            rows.add(pad + line);
        }
        return rows;
    }

    private static String repeat(char c, int n) {
        if (n <= 0) {
            return "";
        }
        return String.valueOf(c).repeat(n);
    }

    /** 播放动画;任意按键中止。任何终端异常都静默退场,让位给静态 banner。 */
    public static void play(Terminal terminal) {
        if (terminal == null) {
            return;
        }
        int cols = terminal.getWidth();
        if (cols <= 0) {
            cols = 80;
        }
        List<List<String>> frames = frames(cols);
        if (frames.isEmpty()) {
            return;
        }
        int h = frames.get(0).size();
        PrintWriter out = terminal.writer();
        NonBlockingReader reader = terminal.reader();
        Attributes prev = null;
        try {
            prev = terminal.enterRawMode();
            out.print(HIDE_CURSOR);
            for (int i = 0; i < h; i++) {
                out.print("\n"); // 预留 h 行画布
            }
            out.flush();
            for (List<String> frame : frames) {
                out.print(ESC + "[" + h + "A\r"); // 回到画布顶端
                for (int r = 0; r < h; r++) {
                    out.print(ESC + "[2K");
                    String row = frame.get(r);
                    if (!row.isEmpty()) {
                        out.print(WHITE + row + RESET);
                    }
                    out.print("\r\n");
                }
                out.flush();
                int c = reader.read(FRAME_MS); // 既控帧速又检测按键
                if (c >= 0) {
                    break; // 按任意键跳过
                }
            }
        } catch (Exception ignored) {
            // 终端不支持 / I/O 异常:直接退场
        } finally {
            try {
                out.print(ESC + "[" + h + "A\r"); // 回到画布顶端
                for (int r = 0; r < h; r++) {
                    out.print(ESC + "[2K\r\n"); // 清掉画布
                }
                out.print(ESC + "[" + h + "A\r"); // 光标留在画布顶端,让 banner 从此处接着画
                out.print(SHOW_CURSOR);
                out.flush();
            } catch (Exception ignored) {
                // ignore
            }
            if (prev != null) {
                try {
                    terminal.setAttributes(prev);
                } catch (Exception ignored) {
                    // ignore
                }
            }
        }
    }
}
