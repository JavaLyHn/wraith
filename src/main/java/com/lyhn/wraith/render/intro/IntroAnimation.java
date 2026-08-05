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
    private static final String WHITE = ESC + "[1m";
    private static final String RESET = ESC + "[0m";
    private static final String HIDE_CURSOR = ESC + "[?25l";
    private static final String SHOW_CURSOR = ESC + "[?25h";
    /**
     * 帧间隔。用户实测反馈「开屏动画非常快」——改前是 38ms × 约 33 帧 ≈ 1.25 秒，
     * 一眨眼就过去了，字标还没看清就没了。
     *
     * <p>放到 46ms（≈22fps，仍然流畅）并把帧数加到约 48 帧，总时长 ≈ 2.2 秒。
     * <b>没有再往上加</b>：CLI 的开场动画是在给启动期（MCP / skill 装配）打掩护的，
     * 长过实际启动耗时就变成纯粹的等待，比太快更烦人。按任意键仍可立刻跳过。
     */
    private static final int FRAME_MS = 46;

    /** 字标逐列显现的步数。12 → 18：这是全片最该被看清的一段，之前扫得太快。 */
    private static final int REVEAL_STEPS = 18;

    /** 摆动序列。尾部多一个 0 让它稳下来，而不是甩到一半就切走。 */
    private static final int[] SWAY = {2, 1, 0, -1, -2, -1, 0, 1, 0, 0};

    /**
     * 节奏用的停顿帧数（重复上一帧）。
     *
     * <p>匀速播完所有帧会显得机械。在三个转折点各停一下，动画才有「呼吸」：
     * 扫描线扫完 → 铺满整屏 → 字标显现完成。停顿靠重复帧实现，
     * 不必给每帧单独配时长，架构不动。
     */
    private static final int HOLD_AFTER_SCAN = 1;
    private static final int HOLD_AFTER_FILL = 2;
    private static final int HOLD_AFTER_REVEAL = 3;
    private static final int HOLD_AT_END = 4;

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
        hold(frames, HOLD_AFTER_SCAN);
        // 1b) 满宽横线从中线向上、下两侧逐帧铺满整块画布,再整屏淡出,过渡到字标显现
        int reach = Math.max(mid, h - 1 - mid);
        for (int r = 0; r <= reach; r++) {
            List<String> f = blank(h);
            int top = Math.max(0, mid - r);
            int bottom = Math.min(h - 1, mid + r);
            for (int row = top; row <= bottom; row++) {
                f.set(row, repeat('█', w));
            }
            frames.add(f);
        }
        // 铺满后整屏淡一下(█ → ▒),让位给随后逐列显现的字标
        List<String> dim = new ArrayList<>(h);
        for (int row = 0; row < h; row++) {
            dim.add(repeat('▒', w));
        }
        frames.add(dim);
        hold(frames, HOLD_AFTER_FILL);
        // 2) 字标自左向右逐列显现
        for (int s = 1; s <= REVEAL_STEPS; s++) {
            int reveal = (int) Math.ceil(width * (double) s / REVEAL_STEPS);
            frames.add(reveal(art, basePad, Math.min(reveal, width)));
        }
        hold(frames, HOLD_AFTER_REVEAL);
        // 3) 左右摆动后回正(末帧 = 居中字标)
        for (int off : SWAY) {
            frames.add(sway(art, basePad, off, width, w));
        }
        // 末尾停住:让居中的字标在切到 banner 前真正被看见。
        // **必须是重复末帧** —— IntroAnimationFramesTest 钉住了「末帧 = 居中字标」。
        hold(frames, HOLD_AT_END);
        return frames;
    }

    /** 重复末帧 n 次,制造停顿。列表为空时什么都不做。 */
    private static void hold(List<List<String>> frames, int n) {
        if (frames.isEmpty()) {
            return;
        }
        List<String> last = frames.get(frames.size() - 1);
        for (int i = 0; i < n; i++) {
            frames.add(last);
        }
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
