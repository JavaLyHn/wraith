package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.StatusInfo;
import org.jline.reader.LineReader;
import org.jline.terminal.Size;
import org.jline.terminal.Terminal;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.io.ByteArrayOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InlineRendererTest {

    @Test
    void onAnsiTerminalEnablesStatusBar() {
        String previous = System.getProperty("wraith.force.ansi");
        System.setProperty("wraith.force.ansi", "true");
        try {
            Terminal terminal = Mockito.mock(Terminal.class);
            Mockito.when(terminal.getType()).thenReturn("xterm-256color");
            Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));

            try (InlineRenderer renderer = new InlineRenderer(terminal)) {
                assertTrue(renderer.hasStatusBar());
                renderer.start();
                renderer.updateStatus(StatusInfo.idle("glm-5.1", 200_000L, false));
            }
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.force.ansi");
            } else {
                System.setProperty("wraith.force.ansi", previous);
            }
        }
    }

    @Test
    void onSmallTerminalDisablesStatusBar() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(40, 4));

        InlineRenderer renderer = new InlineRenderer(terminal);
        try {
            assertFalse(renderer.hasStatusBar());
            // updateStatus should still not throw
            renderer.start();
            renderer.updateStatus(StatusInfo.idle("glm-5.1", 200_000L, false));
        } finally {
            renderer.close();
        }
    }

    @Test
    void streamReturnsSystemOut() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));

        InlineRenderer renderer = new InlineRenderer(terminal);
        try {
            assertNotNull(renderer.stream());
        } finally {
            renderer.close();
        }
    }

    @Test
    void streamUsesPrintAboveWhenLineReaderIsReading() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        LineReader lineReader = Mockito.mock(LineReader.class);
        Mockito.when(lineReader.isReading()).thenReturn(true);
        ByteArrayOutputStream sink = new ByteArrayOutputStream();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.bindLineReader(lineReader);
            renderer.beginTurn();
            renderer.stream().println("异步通知");

            Mockito.verify(lineReader).printAbove("异步通知" + System.lineSeparator());
            assertFalse(sink.toString(StandardCharsets.UTF_8).contains("异步通知"));
        } finally {
            renderer.close();
        }
    }

    @Test
    void streamedCodeBlockUsesCollapsedHeaderWithPrintAbove() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        LineReader lineReader = Mockito.mock(LineReader.class);
        Mockito.when(lineReader.isReading()).thenReturn(true);
        ByteArrayOutputStream sink = new ByteArrayOutputStream();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.bindLineReader(lineReader);
            renderer.beginTurn();
            renderer.stream().println("┌─ code: bash");
            renderer.stream().println("    echo hi");
            renderer.stream().println("└─ end");

            ArgumentCaptor<String> output = ArgumentCaptor.forClass(String.class);
            Mockito.verify(lineReader).printAbove(output.capture());
            String rendered = output.getValue();
            assertTrue(rendered.contains("⏵"), rendered);
            assertTrue(rendered.contains("code: bash"), rendered);
            assertTrue(rendered.contains("1 行"), rendered);
            assertFalse(rendered.contains("echo hi"), rendered);
            assertFalse(sink.toString(StandardCharsets.UTF_8).contains("echo hi"));
        } finally {
            renderer.close();
        }
    }

    @Test
    void inlineRendererKeepsPromptInTranscriptFlow() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(sink, StandardCharsets.UTF_8), true);
        Mockito.when(terminal.writer()).thenReturn(writer);
        Mockito.doAnswer(invocation -> {
            writer.flush();
            return null;
        }).when(terminal).flush();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.start();
            sink.reset();
            renderer.beforeInput();
            renderer.afterInput();

            String emitted = sink.toString(StandardCharsets.UTF_8);
            String prompt = renderer.inputPrompt();
            assertTrue(prompt.contains("›"), "prompt should use › : " + prompt);
            assertFalse(prompt.contains("*"), "old * prompt should be gone: " + prompt);
            assertTrue(prompt.endsWith("› "), "input line tail should be the › prompt: " + prompt);
            assertFalse(prompt.contains("─"), "input prompt must not carry a full-width rule (resize-scatter): " + prompt);
            assertTrue(renderer.inputRightPrompt().contains("@path"));
            assertFalse(emitted.contains("[39;1H"), "LineReader should own the input row: " + emitted);
            assertFalse(emitted.contains("[37;1H"), "renderer should not force transcript cursor rows: " + emitted);
        } finally {
            renderer.close();
        }
    }

    @Test
    void thinkingPanelRendersJLineActivityReasoningAndClears() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(sink, StandardCharsets.UTF_8), true);
        Mockito.when(terminal.writer()).thenReturn(writer);
        Mockito.doAnswer(invocation -> {
            writer.flush();
            return null;
        }).when(terminal).flush();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginThinking("Thinking");
            renderer.appendThinking("先分析用户输入\n再检查状态栏边界");

            String rendered = sink.toString(StandardCharsets.UTF_8);
            assertTrue(renderer.supportsThinkingPanel());
            assertTrue(rendered.contains("Thinking"), rendered);
            assertTrue(rendered.contains("先分析用户输入"), rendered);
            assertTrue(rendered.contains("再检查状态栏边界"), rendered);
            assertTrue(rendered.contains("|") || rendered.contains("│"),
                    "activity display should show live reasoning quote content: " + rendered);

            sink.reset();
            renderer.endThinking();
            String cleared = sink.toString(StandardCharsets.UTF_8);
            assertFalse(cleared.contains(AnsiSeq.CLEAR_TO_EOS),
                    "activity clearing must not clear to screen end and erase transcript scrollback: " + cleared);
        } finally {
            renderer.close();
        }
    }

    @Test
    void activityPanelOmitsCancelHintForNonCancelableWork() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(sink, StandardCharsets.UTF_8), true);
        Mockito.when(terminal.writer()).thenReturn(writer);
        Mockito.doAnswer(invocation -> {
            writer.flush();
            return null;
        }).when(terminal).flush();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginActivity("Compacting conversation", "正在整理早期对话并生成摘要");

            String rendered = sink.toString(StandardCharsets.UTF_8);
            assertTrue(renderer.supportsActivityPanel());
            assertTrue(rendered.contains("Compacting conversation"), rendered);
            assertTrue(rendered.contains("▰"), rendered);
            assertTrue(rendered.contains("▱"), rendered);
            assertTrue(rendered.contains("%"), rendered);
            assertFalse(rendered.contains("正在整理早期对话"), rendered);
            assertFalse(rendered.contains("esc to cancel"), rendered);
        } finally {
            renderer.endActivity();
            renderer.close();
        }
    }

    @Test
    void toggleLastBlockRedrawsTranscriptAroundToolBlock() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 4));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginTurn();
            renderer.stream().println("before");
            renderer.appendToolCalls(List.of(tc("read_file", "{\"path\":\"README.md\"}")));
            renderer.stream().println("after");

            sink.reset();
            assertTrue(renderer.toggleLastBlock());

            String emitted = sink.toString(StandardCharsets.UTF_8);
            assertTrue(emitted.contains("before"), emitted);
            assertTrue(emitted.contains("README.md"), emitted);
            assertTrue(emitted.contains("after"), emitted);
            assertTrue(emitted.contains("collapse"), emitted);
            assertTrue(emitted.contains(AnsiSeq.CLEAR_TO_EOS), emitted);
        } finally {
            renderer.close();
        }
    }

    @Test
    void closeIsIdempotent() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));

        InlineRenderer renderer = new InlineRenderer(terminal);
        renderer.start();
        renderer.close();
        renderer.close();
    }

    @Test
    void promptApprovalDelegatesToFallback() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("dumb");

        InlineRenderer renderer = new InlineRenderer(terminal);
        try {
            // When run without TTY, fallback PlainRenderer reads from stdin.
            // Just verify the call doesn't throw and returns a non-null result.
            // Using `n` as the input is unreliable here, so we skip assertion on actual decision
            // and just verify the type contract by interrupting via empty stdin → reject.
            ApprovalRequest req = ApprovalRequest.of("write_file", "{}", "test");
            ApprovalResult result = renderer.promptApproval(req);
            assertNotNull(result);
        } finally {
            renderer.close();
        }
    }

    @Test
    void openPaletteReturnsMinusOneOnNoInput() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("dumb");

        InlineRenderer renderer = new InlineRenderer(terminal);
        try {
            int idx = renderer.openPalette("title", java.util.List.of("a", "b"));
            assertEquals(-1, idx);
        } finally {
            renderer.close();
        }
    }

    private static LlmClient.ToolCall tc(String name, String args) {
        return new LlmClient.ToolCall(name + "-id", new LlmClient.ToolCall.Function(name, args));
    }

    @Test
    void streamedCodeBlockCollapsesIntoFoldableHeader() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginTurn();
            // 模拟 TerminalMarkdownRenderer 输出的代码块（手写预渲染好的 markup）
            renderer.stream().println("┌─ code: java");
            renderer.stream().println("    public class Main {");
            renderer.stream().println("    }");
            renderer.stream().println("└─ end");

            String emitted = sink.toString(StandardCharsets.UTF_8);
            assertTrue(emitted.contains("⏵"), "应该出现折叠箭头: " + emitted);
            assertTrue(emitted.contains("code: java"), emitted);
            assertTrue(emitted.contains("2 行"), "应统计 body 行数: " + emitted);
            assertTrue(emitted.contains("ctrl+o"), emitted);
            // body 行不应直接显示在 delegate 上（被吞掉了）—— 验证：last occurrence 不包含 "public class"
            // 但因为 delegate.print(line) 还是会先写 body？让我们再确认：检查 final state。
            // 注意：进入代码块后 body 走 codeBodyLines 缓冲，不写 delegate；end 触发 move-up + clear-to-eos
            // 所以 emitted 里包含 ANSI 序列但**不**包含原 body 文本
            assertFalse(emitted.contains("public class Main {"),
                    "代码体应被折叠后不再可见: " + emitted);
        } finally {
            renderer.close();
        }
    }

    @Test
    void streamedCodeBlockTogglesToExpandedOnRedraw() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginTurn();
            renderer.stream().println("┌─ code: bash");
            renderer.stream().println("    echo hi");
            renderer.stream().println("└─ end");

            sink.reset();
            assertTrue(renderer.toggleLastBlock(), "代码块应可 toggle");

            String emitted = sink.toString(StandardCharsets.UTF_8);
            assertTrue(emitted.contains("echo hi"), "展开后应看到代码体: " + emitted);
            assertTrue(emitted.contains("┌─ code: bash"), emitted);
            assertTrue(emitted.contains("└─ end"), emitted);
            assertTrue(emitted.contains("⏷"), "展开态应显示 collapse 提示: " + emitted);
        } finally {
            renderer.close();
        }
    }

    @Test
    void nonCodeStreamingTextStillFlowsThrough() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.beginTurn();
            renderer.stream().println("普通段落 1");
            renderer.stream().println("普通段落 2");

            String emitted = sink.toString(StandardCharsets.UTF_8);
            assertTrue(emitted.contains("普通段落 1"), emitted);
            assertTrue(emitted.contains("普通段落 2"), emitted);
            // 不应出现折叠箭头
            assertFalse(emitted.contains("⏵"));
        } finally {
            renderer.close();
        }
    }

    /**
     * <b>思考面板不该跟着状态栏一起消失。</b>
     *
     * <p>改之前 {@code InlineRenderer} 写的是
     * {@code activityDisplay = statusBar == null ? null : new InlineActivityDisplay(..., statusBar)}，
     * 而那个 {@code statusBar} 参数在 {@code InlineActivityDisplay} 里<b>根本没被用过</b>
     * （没字段、没引用）——纯粹的假耦合。
     *
     * <p>后果很实在：终端一降级（dumb / 行数 &lt; 5 / 显式 {@code WRAITH_NO_STATUSBAR=true}）
     * 就连 spinner 和 reasoning 的即时显示一起没了，只能落到 {@code Agent} 里
     * 「攒够 120 字符才 flush」的兜底路上。用户只想关状态栏，丢的却是「知道它在动」。
     *
     * <p>两者的前提本来不同：状态栏要 scroll region（DECSTBM，需要<b>准确行数</b>），
     * 思考面板只用 {@code \n} / {@code CLEAR_TO_EOL} 原地擦重画，能写 ANSI 就够。
     */
    @org.junit.jupiter.api.Test
    @org.junit.jupiter.api.DisplayName("**没有状态栏时思考面板仍在** —— 两者前提不同,不该绑在一起")
    void thinkingPanelSurvivesWithoutStatusBar() {
        org.jline.terminal.Terminal dumb = org.mockito.Mockito.mock(org.jline.terminal.Terminal.class);
        org.mockito.Mockito.when(dumb.getType()).thenReturn("dumb");
        org.mockito.Mockito.when(dumb.getSize()).thenReturn(new org.jline.terminal.Size(120, 40));
        java.io.ByteArrayOutputStream sink = new java.io.ByteArrayOutputStream();
        try (InlineRenderer r = new InlineRenderer(dumb,
                new java.io.PrintStream(sink, true, java.nio.charset.StandardCharsets.UTF_8))) {
            // 前提:这台终端确实拿不到 scroll region(所以没有状态栏)
            org.junit.jupiter.api.Assertions.assertFalse(
                    TerminalCapabilities.supportsScrollRegion(dumb),
                    "前提不成立:这个 mock 应该是拿不到 scroll region 的");
            // 而思考面板/活动面板必须仍然可用
            org.junit.jupiter.api.Assertions.assertTrue(r.supportsThinkingPanel(),
                    "没有状态栏就没有思考面板 —— 那正是要修的假耦合");
            org.junit.jupiter.api.Assertions.assertTrue(r.supportsActivityPanel(),
                    "活动面板同理:TurnPreparationNotice 靠它,否则准备期只剩一行静态文字");
        }
    }

    /**
     * 用户 Windows 实测的原样输出 —— 快照失败提示被<b>挤进活动面板的进度条那一行</b>：
     * <pre>
     *     ▰▱▱▱▱▱▱… 1%[!] pre-turn 快照失败：JGitInternalException: …
     *    （…或 -Dwraith.snapshot.enabled?
     * </pre>
     * 末尾的 {@code =false）} 还被下一次重绘覆盖掉，<b>连「怎么关掉」都没读全</b>。
     *
     * <p>根因是面板有自己的 250ms 重绘线程，别的线程直接 {@code println} 不走它的 monitor。
     * 修法：{@code printNotice} → {@code InlineActivityDisplay.printAbove}，
     * 先擦掉面板占的行、把提示当正常输出打完（成为滚动历史），再把面板重画在下面。
     */
    @org.junit.jupiter.api.Test
    @org.junit.jupiter.api.DisplayName("**系统提示不能被挤进面板那一行** —— 整段要完整,且以换行收尾")
    void printNoticeDoesNotCollideWithTheActivityPanel() {
        Terminal terminal = Mockito.mock(Terminal.class);
        Mockito.when(terminal.getType()).thenReturn("xterm-256color");
        Mockito.when(terminal.getSize()).thenReturn(new Size(120, 40));
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(sink, StandardCharsets.UTF_8), true);
        Mockito.when(terminal.writer()).thenReturn(writer);
        Mockito.doAnswer(invocation -> {
            writer.flush();
            return null;
        }).when(terminal).flush();

        InlineRenderer renderer = new InlineRenderer(terminal,
                new PrintStream(sink, true, StandardCharsets.UTF_8));
        try {
            renderer.start();
            renderer.beginActivity("准备本轮", "保存快照 / 装配上下文");
            sink.reset();

            String notice = "⚠️ pre-turn 快照失败：LockFailedException: Cannot lock …index\n"
                    + "   （不想要快照可以关掉：设 WRAITH_SNAPSHOT_ENABLED=false）";
            renderer.printNotice(notice);

            String emitted = sink.toString(StandardCharsets.UTF_8);
            assertTrue(emitted.contains("pre-turn 快照失败"), emitted);
            assertTrue(emitted.contains("WRAITH_SNAPSHOT_ENABLED=false）"),
                    "整段必须完整落地,尾巴不能被吃掉: " + emitted);
            int noticeEnd = emitted.indexOf("WRAITH_SNAPSHOT_ENABLED=false）");
            int panelAfter = emitted.indexOf("准备本轮", noticeEnd);
            assertTrue(panelAfter > noticeEnd, "面板要重画在提示**之后**: " + emitted);
            assertTrue(emitted.substring(noticeEnd, panelAfter).contains("\n"),
                    "提示与面板之间必须有换行,否则就是那次挤在一行的原样复现: " + emitted);
        } finally {
            renderer.close();
        }
    }

    @org.junit.jupiter.api.Test
    @org.junit.jupiter.api.DisplayName("WRAITH_NO_STATUSBAR 只关状态栏,不该连思考面板一起关")
    void noStatusBarPropertyDoesNotKillThinkingPanel() {
        String saved = System.getProperty("wraith.no.statusbar");
        System.setProperty("wraith.no.statusbar", "true");
        try {
            org.jline.terminal.Terminal t = org.mockito.Mockito.mock(org.jline.terminal.Terminal.class);
            org.mockito.Mockito.when(t.getType()).thenReturn("xterm-256color");
            org.mockito.Mockito.when(t.getSize()).thenReturn(new org.jline.terminal.Size(120, 40));
            java.io.ByteArrayOutputStream sink = new java.io.ByteArrayOutputStream();
            try (InlineRenderer r = new InlineRenderer(t,
                    new java.io.PrintStream(sink, true, java.nio.charset.StandardCharsets.UTF_8))) {
                org.junit.jupiter.api.Assertions.assertFalse(
                        TerminalCapabilities.supportsScrollRegion(t), "前提:开关应该关掉了状态栏");
                org.junit.jupiter.api.Assertions.assertTrue(r.supportsThinkingPanel(),
                        "用户只想关状态栏,不是要连思考过程一起关掉");
            }
        } finally {
            if (saved == null) {
                System.clearProperty("wraith.no.statusbar");
            } else {
                System.setProperty("wraith.no.statusbar", saved);
            }
        }
    }
}
