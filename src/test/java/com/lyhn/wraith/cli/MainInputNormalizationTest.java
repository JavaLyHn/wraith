package com.lyhn.wraith.cli;

import com.lyhn.wraith.llm.LlmClient;
import org.jline.reader.History;
import org.jline.reader.LineReader;
import org.jline.reader.LineReaderBuilder;
import org.jline.reader.impl.history.DefaultHistory;
import org.jline.terminal.Terminal;
import org.jline.terminal.TerminalBuilder;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MainInputNormalizationTest {

    @Test
    void keepsMultilinePasteStructure() {
        String normalized = Main.prepareSeedBuffer("请把任务拆成可并行的 DAG:\n1. 读 pom.xml\r\n2. 列出 src/main/java");

        assertEquals("请把任务拆成可并行的 DAG:\n1. 读 pom.xml\n2. 列出 src/main/java", normalized);
    }

    @Test
    void keepsSingleLineInputUntouched() {
        String normalized = Main.prepareSeedBuffer("帮我读取 pom.xml");

        assertEquals("帮我读取 pom.xml", normalized);
    }

    @Test
    void normalizesLegacyCarriageReturnsWithoutChangingTextLayout() {
        String normalized = Main.prepareSeedBuffer("第一行\r第二行\r\n第三行");

        assertEquals("第一行\n第二行\n第三行", normalized);
    }

    @Test
    void startupHintsKeepSlashCommandDetailsOutOfInitialScreen() {
        List<String> hints = Main.startupHints();

        assertTrue(hints.stream().anyMatch(hint -> hint.contains("输入 '/' 查看完整命令列表，↑↓ 选择，Enter 执行")));
        assertTrue(hints.stream().noneMatch(hint -> hint.contains("/model")));
        assertTrue(hints.stream().noneMatch(hint -> hint.contains("/index [路径]")));
        assertTrue(hints.stream().noneMatch(hint -> hint.contains("/skill list")));
    }

    @Test
    void startupBannerUsesOpenLayoutWithoutRightBorder() {
        List<String> lines = Main.startupBannerLines();

        assertTrue(lines.stream().anyMatch(line -> line.contains("Wraith")));
        assertTrue(lines.stream().anyMatch(line -> line.contains("╚███╔███╔╝")),
                "banner should render the large WRAITH wordmark");
        assertTrue(lines.stream().anyMatch(line -> line.contains("v16.1.0")));
        assertTrue(lines.stream().anyMatch(line -> line.contains("████████╗")));
        assertTrue(lines.stream().anyMatch(line -> line.contains("Tips for getting started")));
        assertTrue(lines.stream().anyMatch(line -> line.contains("@path")));
        assertTrue(lines.stream().noneMatch(line -> line.contains("for shortcuts")));
        assertTrue(lines.stream().noneMatch(line -> line.contains("────────────────")));
        assertTrue(lines.stream()
                        .filter(line -> line.contains("v16.1.0") || line.contains("Tips for getting started"))
                        .noneMatch(line -> line.endsWith("║")),
                "banner should not depend on a padded right border");
    }

    @Test
    void suggestionTailReturnsNewestHistoryMatchRemainder() {
        List<String> history = List.of("git status", "git commit -m x", "mvn test");
        assertEquals(" commit -m x", Main.suggestionTail(history, "git"));
        assertNull(Main.suggestionTail(history, "docker"), "no match -> null");
        assertNull(Main.suggestionTail(history, ""), "empty prefix -> null");
        assertNull(Main.suggestionTail(List.of("ls"), "ls"), "equal-length match has no remainder");
    }

    @Test
    void slashCommandTailTipsExposeCommandDescriptions() {
        var tips = Main.slashCommandTailTips();

        assertTrue(tips.containsKey("/model"));
        assertTrue(tips.get("/model").getMainDesc().get(0).toString().contains("查看当前模型"));
        assertTrue(tips.containsKey("/plan <任务内容>"));
    }

    @Test
    void promptDoesNotUseBottomSpaciousModeByDefault() {
        assertFalse(Main.defaultSpaciousPrompt(false));
        assertFalse(Main.defaultSpaciousPrompt(true));
    }

    @Test
    void mcpStartupWaitCanBeTunedForTerminalSmoke() {
        String old = System.getProperty("wraith.mcp.startup.wait.seconds");
        try {
            System.setProperty("wraith.mcp.startup.wait.seconds", "2");

            assertEquals(Duration.ofSeconds(2), Main.mcpStartupWait());
        } finally {
            restoreProperty("wraith.mcp.startup.wait.seconds", old);
        }
    }

    @Test
    void submittedPromptIsRenderedBackIntoTranscript() {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();

        Main.printSubmittedPrompt(new PrintStream(sink, true, StandardCharsets.UTF_8), "  LyHn是谁？  ");

        String emitted = sink.toString(StandardCharsets.UTF_8);
        assertTrue(emitted.contains(">"), emitted);
        assertTrue(emitted.contains("LyHn是谁？"), emitted);
        assertTrue(emitted.endsWith("\n"), emitted);
        assertFalse(emitted.endsWith("\n\n"), emitted);
    }

    @Test
    void submittedSingleLinePromptDoesNotAddExtraBlankLine() {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();

        Main.printSubmittedPrompt(new PrintStream(sink, true, StandardCharsets.UTF_8), "你好啊");

        String emitted = sink.toString(StandardCharsets.UTF_8);
        assertEquals(1, emitted.chars().filter(ch -> ch == '\n').count(), emitted);
        assertTrue(emitted.contains(">"), emitted);
        assertTrue(emitted.contains("你好啊"), emitted);
    }

    @Test
    void submittedSlashCommandIsRenderedBackIntoTranscript() {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();

        Main.printSubmittedInput(null, new PrintStream(sink, true, StandardCharsets.UTF_8), "/memory list");

        String emitted = sink.toString(StandardCharsets.UTF_8);
        assertTrue(emitted.contains(">"), emitted);
        assertTrue(emitted.contains("/memory list"), emitted);
        assertEquals(1, emitted.chars().filter(ch -> ch == '\n').count(), emitted);
    }

    @Test
    void configuresAwtHeadlessOnMac() {
        String oldOs = System.getProperty("os.name");
        String oldHeadless = System.getProperty("java.awt.headless");
        try {
            System.setProperty("os.name", "Mac OS X");
            System.clearProperty("java.awt.headless");

            Main.configureAwtForCli();

            assertEquals("true", System.getProperty("java.awt.headless"));
        } finally {
            restoreProperty("os.name", oldOs);
            restoreProperty("java.awt.headless", oldHeadless);
        }
    }

    @Test
    void doesNotForceAwtHeadlessOnNonMac() {
        String oldOs = System.getProperty("os.name");
        String oldHeadless = System.getProperty("java.awt.headless");
        try {
            System.setProperty("os.name", "Linux");
            System.clearProperty("java.awt.headless");

            Main.configureAwtForCli();

            assertFalse(System.getProperties().containsKey("java.awt.headless"));
        } finally {
            restoreProperty("os.name", oldOs);
            restoreProperty("java.awt.headless", oldHeadless);
        }
    }

    @Test
    void clearsCurrentInputBufferForEscWidget() throws Exception {
        LineReader lineReader = newLineReader();
        lineReader.getBuffer().write("@image:</tmp/shot.png> 这张图呢");

        Main.clearInputBuffer(lineReader);

        assertEquals("", lineReader.getBuffer().toString());
    }

    @Test
    void slashCommandListForEmptyBufferReturnsFullCommandList() {
        String list = Main.slashCommandListForBuffer("", 120);

        assertNotNull(list);
        // 之前 widget 只 write("/") —— 用户按 / 什么都看不到,这正是本任务要修的回归。
        assertTrue(list.contains("/model"), list);
        assertTrue(list.contains("/browser status"), list);
        assertTrue(list.contains("/memory pending"), list);
    }

    @Test
    void slashCommandListForNonEmptyBufferReturnsNull() {
        // 行内其它位置的 /（URL、路径片段）按字面量写入,不刷命令清单。
        assertNull(Main.slashCommandListForBuffer("ab", 120));
        assertNull(Main.slashCommandListForBuffer("https://example", 120));
        assertNull(Main.slashCommandListForBuffer(null, 120));
    }

    @Test
    void slashWidgetPrintsFullCommandListOnEmptyBuffer() throws Exception {
        // 直接驱动 widget.apply():既能验"空行首字符 / 真的把清单写进终端输出",
        // 又不依赖 readLine（dumb 终端喂 canned 字节会抛 EndOfFile）。
        // printAbove 在非读取态会落到 terminal.writer(),这里捕获它。
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Terminal terminal = TerminalBuilder.builder()
                .dumb(true)
                .streams(new ByteArrayInputStream(new byte[0]), out)
                .build();
        LineReader lineReader = LineReaderBuilder.builder()
                .terminal(terminal)
                .history(new DefaultHistory())
                .build();
        Main.configureSlashCommandHint(lineReader);
        org.jline.reader.Widget widget =
                (org.jline.reader.Widget) lineReader.getWidgets().get("wraith-slash-command-hint");

        widget.apply();

        assertEquals("/", lineReader.getBuffer().toString());
        String output = out.toString(StandardCharsets.UTF_8);
        assertTrue(output.contains("/model"), "应打印完整命令清单: " + output);
        assertTrue(output.contains("/memory pending"), output);
    }

    @Test
    void slashWidgetDoesNotPrintListWhenBufferNotEmpty() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Terminal terminal = TerminalBuilder.builder()
                .dumb(true)
                .streams(new ByteArrayInputStream(new byte[0]), out)
                .build();
        LineReader lineReader = LineReaderBuilder.builder()
                .terminal(terminal)
                .history(new DefaultHistory())
                .build();
        Main.configureSlashCommandHint(lineReader);
        lineReader.getBuffer().write("ab");
        org.jline.reader.Widget widget =
                (org.jline.reader.Widget) lineReader.getWidgets().get("wraith-slash-command-hint");

        widget.apply();

        assertEquals("ab/", lineReader.getBuffer().toString());
        String output = out.toString(StandardCharsets.UTF_8);
        assertFalse(output.contains("可用命令"), "非空行不该刷命令清单: " + output);
    }

    @Test
    void slashCommandHintsIncludeRagSlashCommands() {
        List<String> commands = Main.slashCommandHints().stream()
                .map(Main.SlashCommandHint::display)
                .toList();

        assertTrue(commands.contains("/index [路径]"));
        assertTrue(commands.contains("/search <查询>"));
        assertTrue(commands.contains("/graph <类名>"));
        assertTrue(commands.contains("/compact"));
    }

    @Test
    void slashCommandChoicesAreRenderedDirectlyWithoutJLineConfirmationText() {
        String choices = Main.formatSlashCommandChoices(120);

        // 断言换成与 provider 无关的命令:provider 名已不在这张静态表里,
        // 它们由 config 驱动的 WraithCompleter.completeModel 提供(见 Task 5)。
        // 这条测试的真实意图是「紧凑多列直接渲染、不带 JLine 确认文案」,
        // 原先那 6 条 /model glm-5.1 之类的断言只是脚手架,且正是本任务要删的硬编码。
        assertTrue(choices.contains("/model"), choices);
        assertTrue(choices.contains("/browser status"), choices);
        assertTrue(choices.contains("/plan"), choices);
        assertFalse(choices.contains("do you wish"), choices);
        assertFalse(choices.contains("glm-5.1"),
                "provider/模型名不该再出现在静态提示表里: " + choices);
        assertTrue(choices.lines().count() < Main.slashCommandHints().size(),
                "choices should be compact multi-column output");
    }

    @Test
    void exportIncludesSystemOnlyHistoryForPromptInspection() {
        List<LlmClient.Message> history = List.of(LlmClient.Message.system("system prompt"));

        assertTrue(Main.hasExportableMessages(history));
        assertEquals(1, Main.countExportedMessages(history));

        String markdown = Main.renderConversationExport(history, LocalDateTime.of(2026, 6, 10, 14, 17));

        assertTrue(markdown.contains("## System"), markdown);
        assertTrue(markdown.contains("system prompt"), markdown);
        assertFalse(markdown.contains("System prompt 已省略"), markdown);
    }

    @Test
    void rendersConversationExportWithSafeCodeFences() {
        List<LlmClient.Message> history = List.of(
                LlmClient.Message.system("system prompt"),
                LlmClient.Message.user("请读取代码"),
                LlmClient.Message.assistant(
                        "模型思考",
                        "准备调用工具",
                        List.of(new LlmClient.ToolCall("call_1",
                                new LlmClient.ToolCall.Function("write_file",
                                        "{\"path\":\"demo.md\",\"content\":\"```java\\nclass A {}\\n```\"}")))),
                LlmClient.Message.tool("call_1", "工具结果里也有围栏:\n```java\nclass B {}\n```")
        );

        String markdown = Main.renderConversationExport(history, LocalDateTime.of(2026, 6, 10, 14, 30));

        assertTrue(markdown.contains("**导出时间**: 2026-06-10 14:30"), markdown);
        assertTrue(markdown.contains("## System\n\nsystem prompt"), markdown);
        assertFalse(markdown.contains("System prompt 已省略"), markdown);
        assertTrue(markdown.contains("请读取代码"), markdown);
        assertTrue(markdown.contains("> **思考过程**"), markdown);
        assertTrue(markdown.contains("````json"), markdown);
        assertTrue(markdown.contains("\"content\" : \"```java\\nclass A {}\\n```\""), markdown);
        assertTrue(markdown.contains("````\n工具结果里也有围栏:"), markdown);
        assertTrue(markdown.contains("```java\nclass B {}\n```"), markdown);
        assertTrue(markdown.contains("\n````\n"), markdown);
        assertEquals(4, Main.countExportedMessages(history));
    }

    @Test
    void classifiesStandaloneEscapeAsCancelIntent() {
        assertEquals(Main.EscapeSequenceType.STANDALONE_ESC, Main.classifyEscapeSequence(""));
    }

    @Test
    void classifiesArrowKeysAsControlSequences() {
        assertEquals(Main.EscapeSequenceType.CONTROL_SEQUENCE, Main.classifyEscapeSequence("[A"));
        assertEquals(Main.EscapeSequenceType.CONTROL_SEQUENCE, Main.classifyEscapeSequence("[B"));
        assertEquals(Main.EscapeSequenceType.CONTROL_SEQUENCE, Main.classifyEscapeSequence("OA"));
    }

    @Test
    void classifiesBracketedPasteSequenceSeparately() {
        assertEquals(Main.EscapeSequenceType.BRACKETED_PASTE, Main.classifyEscapeSequence("[200~hello"));
    }

    @Test
    void upArrowPrefillsLatestHistoryEntry() throws Exception {
        LineReader lineReader = newLineReader();
        History history = lineReader.getHistory();
        history.add("第一条");
        history.add("最近一条");

        assertEquals("最近一条", Main.seedBufferForHistoryNavigation(lineReader, "[A"));
    }

    @Test
    void downArrowKeepsPromptEmpty() throws Exception {
        LineReader lineReader = newLineReader();
        lineReader.getHistory().add("最近一条");

        assertEquals("", Main.seedBufferForHistoryNavigation(lineReader, "[B"));
    }

    @Test
    void decideEscCancelTriggersOnStandaloneEsc() {
        // 单 ESC（escTail 为空）→ 取消
        assertTrue(Main.decideEscCancel(27, ""));
        assertTrue(Main.decideEscCancel(27, null));
    }

    @Test
    void decideEscCancelIgnoresArrowKeyEscapeSequence() {
        // 上方向键 ESC[A → CONTROL_SEQUENCE，不取消
        assertFalse(Main.decideEscCancel(27, "[A"));
        // 下方向键
        assertFalse(Main.decideEscCancel(27, "[B"));
        // 应用模式方向键
        assertFalse(Main.decideEscCancel(27, "OA"));
    }

    @Test
    void decideEscCancelIgnoresBracketedPaste() {
        assertFalse(Main.decideEscCancel(27, "[200~hello"));
    }

    @Test
    void decideEscCancelIgnoresNonEscFirstByte() {
        // 普通字符不应触发
        assertFalse(Main.decideEscCancel((int) 'a', null));
        assertFalse(Main.decideEscCancel((int) '/', "cancel"));
        assertFalse(Main.decideEscCancel(0, null));
        assertFalse(Main.decideEscCancel(-1, null));
    }

    @Test
    void readEscCancelHandlesNullTerminalSafely() {
        assertFalse(Main.readEscCancel(null));
    }

    private static void restoreProperty(String key, String value) {
        if (value == null) {
            System.clearProperty(key);
        } else {
            System.setProperty(key, value);
        }
    }

    // ── 斜杠命令实时选择器测试 ──

    @Test
    void filterSlashCommandsByPrefix() {
        List<Main.SlashCommandHint> filtered = Main.filterSlashCommands("/m");

        assertTrue(filtered.size() >= 3, "至少 /model, /memory, /mcp: " + filtered.size());
        assertTrue(filtered.stream().allMatch(h -> h.insertText().startsWith("/m")),
                "所有结果应以 /m 开头");
    }

    @Test
    void filterSlashCommandsEmptyPrefixReturnsEmpty() {
        assertTrue(Main.filterSlashCommands("").isEmpty());
        assertTrue(Main.filterSlashCommands(null).isEmpty());
    }

    @Test
    void filterSlashCommandsNarrowsWithLongerPrefix() {
        // /m 命中 /model* + /mcp* + /memory* 共 18 条；
        // /mem 只命中 /memory* 9 条 —— 真正体现"前缀越长匹配越少"。
        // 注：/mo 和 /mod 均命中 /model 与 /model <provider> 两条,数量相同,
        // 不能用来验证本性质。
        List<Main.SlashCommandHint> m = Main.filterSlashCommands("/m");
        List<Main.SlashCommandHint> mem = Main.filterSlashCommands("/mem");

        assertTrue(m.size() > mem.size(),
                "前缀越长匹配越少: /m=" + m.size() + " /mem=" + mem.size());
        assertTrue(mem.stream().allMatch(h -> h.insertText().startsWith("/mem")));
    }

    @Test
    void filterSlashCommandsNoMatchReturnsEmpty() {
        assertTrue(Main.filterSlashCommands("/zzz").isEmpty());
    }

    @Test
    void slashOverlayComputeReturnsNullForNonSlashBuffer() {
        assertNull(Main.slashOverlayCompute("", 0, 120));
        assertNull(Main.slashOverlayCompute("hello", 0, 120));
        assertNull(Main.slashOverlayCompute(null, 0, 120));
    }

    @Test
    void slashOverlayComputeReturnsFullListForSlashOnly() {
        var result = Main.slashOverlayCompute("/", 0, 120);

        assertNotNull(result);
        assertFalse(result.filtered().isEmpty());
        assertTrue(result.text().contains("/model"), result.text());
        assertTrue(result.text().contains("▶"), "首项应被选中: " + result.text());
    }

    @Test
    void slashOverlayComputeFiltersByPrefix() {
        var result = Main.slashOverlayCompute("/me", 0, 120);

        assertNotNull(result);
        assertTrue(result.filtered().stream().allMatch(h -> h.insertText().startsWith("/me")));
        assertTrue(result.text().contains("/memory"), result.text());
        assertFalse(result.text().contains("/model"), "/model 不应出现在 /me 过滤中: " + result.text());
    }

    @Test
    void slashOverlayComputeShowsNoMatchMessage() {
        var result = Main.slashOverlayCompute("/zzz", 0, 120);

        assertNotNull(result);
        assertTrue(result.filtered().isEmpty());
        assertTrue(result.text().contains("无匹配命令"), result.text());
    }

    @Test
    void slashOverlayComputeClampsSelectedIndex() {
        var result = Main.slashOverlayCompute("/", 999, 120);

        assertNotNull(result);
        assertTrue(result.selectedIndex() < result.filtered().size(),
                "选中索引应被钳制到有效范围");
    }

    @Test
    void formatSlashCommandOverlayMarksSelectedItem() {
        List<Main.SlashCommandHint> filtered = Main.filterSlashCommands("/c");
        String text = Main.formatSlashCommandOverlay(filtered, 0, 120);

        String[] lines = text.split("\n");
        assertTrue(lines.length >= 3, "应有标题行 + 至少 2 条命令");
        assertEquals("可用命令（↑↓ 选择，Enter 执行，Tab 补全）：", lines[0]);
        // 第一条命令应被选中
        assertTrue(lines[1].startsWith("▶ "), "首行应有选中标记: " + lines[1]);
        // 后续命令不应有选中标记
        if (lines.length > 2) {
            assertTrue(lines[2].startsWith("  "), "非选中行应有缩进: " + lines[2]);
        }
    }

    @Test
    void slashCommandNeedsParametersDetectsAngleBrackets() {
        List<Main.SlashCommandHint> hints = Main.slashCommandHints();
        Main.SlashCommandHint modelProvider = hints.stream()
                .filter(h -> h.display().equals("/model <provider>"))
                .findFirst().orElseThrow();
        Main.SlashCommandHint clear = hints.stream()
                .filter(h -> h.display().equals("/clear"))
                .findFirst().orElseThrow();

        assertTrue(Main.slashCommandNeedsParameters(modelProvider),
                "/model <provider> 需要参数");
        assertFalse(Main.slashCommandNeedsParameters(clear),
                "/clear 不需要参数");
    }

    @Test
    void slashCommandExecutableFormStripsOptionalParams() {
        List<Main.SlashCommandHint> hints = Main.slashCommandHints();
        Main.SlashCommandHint archive = hints.stream()
                .filter(h -> h.display().equals("/archive [标题]"))
                .findFirst().orElseThrow();
        Main.SlashCommandHint clear = hints.stream()
                .filter(h -> h.display().equals("/clear"))
                .findFirst().orElseThrow();

        assertEquals("/archive", Main.slashCommandExecutableForm(archive),
                "应剥离 [标题] 可选参数");
        assertEquals("/clear", Main.slashCommandExecutableForm(clear),
                "无参命令原样返回");
    }

    @Test
    void slashWidgetShowsOverlayOnEmptyBuffer() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Terminal terminal = TerminalBuilder.builder()
                .dumb(true)
                .streams(new ByteArrayInputStream(new byte[0]), out)
                .build();
        LineReader lineReader = LineReaderBuilder.builder()
                .terminal(terminal)
                .history(new DefaultHistory())
                .build();
        Main.configureSlashCommandHint(lineReader);
        org.jline.reader.Widget widget =
                (org.jline.reader.Widget) lineReader.getWidgets().get("wraith-slash-command-hint");

        widget.apply();

        assertEquals("/", lineReader.getBuffer().toString());
        String output = out.toString(StandardCharsets.UTF_8);
        assertTrue(output.contains("/model"), "应显示命令覆盖层: " + output);
        // dumb terminal 在 Windows 上用平台编码(GBK),↑↓ 等非 ASCII 字符会乱码；
        // 选择提示行 "可用命令（↑↓ 选择，Enter 执行，Tab 补全）：" 里的
        // Enter/Tab 是 ASCII,用来确认覆盖层格式(而非旧的全列表格式)被写入。
        assertTrue(output.contains("Enter") && output.contains("Tab"),
                "应包含选择提示: " + output);
    }

    @Test
    void slashWidgetDoesNotShowOverlayWhenBufferNotEmpty() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Terminal terminal = TerminalBuilder.builder()
                .dumb(true)
                .streams(new ByteArrayInputStream(new byte[0]), out)
                .build();
        LineReader lineReader = LineReaderBuilder.builder()
                .terminal(terminal)
                .history(new DefaultHistory())
                .build();
        Main.configureSlashCommandHint(lineReader);
        lineReader.getBuffer().write("ab");
        org.jline.reader.Widget widget =
                (org.jline.reader.Widget) lineReader.getWidgets().get("wraith-slash-command-hint");

        widget.apply();

        assertEquals("ab/", lineReader.getBuffer().toString());
        String output = out.toString(StandardCharsets.UTF_8);
        assertFalse(output.contains("可用命令"), "非空行不该刷命令清单: " + output);
    }

    private static LineReader newLineReader() throws Exception {
        Terminal terminal = TerminalBuilder.builder()
                .dumb(true)
                .streams(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream())
                .build();

        DefaultHistory history = new DefaultHistory();
        return LineReaderBuilder.builder()
                .terminal(terminal)
                .history(history)
                .build();
    }
}
