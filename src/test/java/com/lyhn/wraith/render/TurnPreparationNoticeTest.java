package com.lyhn.wraith.render;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * pty 实测：提交后 <b>8.26 秒</b>零输出，spinner 才开始转（而且它自己显示
 * {@code (esc to cancel, 0s)}，说明 {@code beginThinking} 是那一刻才被调的）。
 * 那 8 秒花在 {@code SnapshotService.runTurn} 的同步 pre-turn 快照上。
 */
class TurnPreparationNoticeTest {

    /**
     * 记录调用顺序的假渲染器。
     *
     * <p>{@code PlainRenderer} 是 {@code final}，继承不了；接口的默认方法覆盖了大部分，
     * 这里只实现编译器要求的那 8 个抽象方法。
     */
    private static final class Recording implements Renderer {
        final List<String> calls = new ArrayList<>();
        private final boolean activityPanel;

        Recording(boolean activityPanel) {
            this.activityPanel = activityPanel;
        }

        @Override
        public boolean supportsActivityPanel() {
            return activityPanel;
        }

        @Override
        public void beginActivity(String label, String detail) {
            calls.add("beginActivity:" + label + "|" + detail);
        }

        @Override
        public void endActivity() {
            calls.add("endActivity");
        }

        // ── 以下都是接口要求但本用例不关心的 ──
        @Override public void start() { }
        @Override public void close() { }
        @Override public PrintStream stream() {
            return new PrintStream(java.io.OutputStream.nullOutputStream(), true, StandardCharsets.UTF_8);
        }
        @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) { }
        @Override public void appendDiff(String filePath, String before, String after) { }
        @Override public void updateStatus(StatusInfo status) { }
        @Override public com.lyhn.wraith.hitl.ApprovalResult promptApproval(
                com.lyhn.wraith.hitl.ApprovalRequest request) {
            return null;
        }
        @Override public int openPalette(String title, List<String> items) {
            return -1;
        }
    }

    @Test
    @DisplayName("**支持活动面板时立刻点亮** —— 这是那 8 秒里唯一能让人知道「在动」的东西")
    void lightsUpActivityPanelImmediately() {
        Recording r = new Recording(true);
        Runnable end = TurnPreparationNotice.begin(r, null);
        assertEquals(1, r.calls.size(), r.calls.toString());
        assertTrue(r.calls.get(0).startsWith("beginActivity:"), r.calls.toString());
        assertTrue(r.calls.get(0).contains("准备"), r.calls.toString());
        assertTrue(r.calls.get(0).contains("快照"), "要说清在干什么,否则用户不知道能不能等: " + r.calls);
        end.run();
        assertEquals(List.of(r.calls.get(0), "endActivity"), r.calls);
    }

    @Test
    @DisplayName("不支持活动面板时退化成一行字 —— **一行字也比整屏静止好**")
    void fallsBackToASingleLine() {
        Recording r = new Recording(false);
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        Runnable end = TurnPreparationNotice.begin(r, new PrintStream(sink, true, StandardCharsets.UTF_8));
        assertTrue(r.calls.isEmpty(), "不该碰活动面板 API: " + r.calls);
        String printed = sink.toString(StandardCharsets.UTF_8);
        assertTrue(printed.contains("准备"), printed);
        assertTrue(printed.contains("快照"), printed);
        end.run();   // 不抛
    }

    @Test
    @DisplayName("renderer 为 null / 输出流为 null 都不抛 —— 它在 finally 里跑,绝不能自己炸")
    void nullsAreSafe() {
        TurnPreparationNotice.begin(null, null).run();
        Recording r = new Recording(false);
        TurnPreparationNotice.begin(r, null).run();
        assertTrue(r.calls.isEmpty());
    }

    @Test
    @DisplayName("收尾动作可以重复调用 —— Agent 的 beginThinking 会接管面板,end 必须幂等")
    void endIsIdempotent() {
        Recording r = new Recording(true);
        Runnable end = TurnPreparationNotice.begin(r, null);
        end.run();
        end.run();
        assertEquals(3, r.calls.size(), "两次 end 都该落到渲染器,由它自己幂等: " + r.calls);
    }
}
