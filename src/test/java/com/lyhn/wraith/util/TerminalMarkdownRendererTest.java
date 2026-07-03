package com.lyhn.wraith.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TerminalMarkdownRendererTest {
    static {
        System.setProperty("wraith.render.color", "false");
    }

    /**
     * Strip ANSI CSI escape sequences so width assertions compare visible
     * character count rather than raw string length (which includes invisible
     * escape bytes).
     *
     * Order-dependency root cause: AnsiStyle.ENABLED is a static final field
     * resolved once at class-init time. During a full suite run, an earlier
     * test loads AnsiStyle before this test class's static initializer can set
     * wraith.render.color=false, so ENABLED is permanently true for that JVM.
     * As a result, table rows in wrapsWideMultiColumnTableInsideTerminalWidth
     * are wrapped with ANSI CSI codes (e.g. ESC[1m + ESC[36m + text + ESC[0m
     * = up to 13 extra invisible bytes), pushing line.length() above 72 and
     * failing the assertion even though the visual content is within 72 chars.
     * When run in isolation the class loads first, the static initializer fires
     * before AnsiStyle initializes, ENABLED becomes false and the test passes.
     *
     * Fix (test-side isolation only, no rendering implementation changes):
     * Strip ANSI escape bytes before the length check. The assertion intent is
     * that the visible/display width must not exceed the declared terminal
     * width, so comparing stripped length is semantically correct and
     * order-independent.
     */
    private static String stripAnsi(String s) {
        // Match ESC (U+001B) + '[' + optional numeric params + 'm'
        return s.replaceAll("\\[[0-9;]*m", "");
    }

    @Test
    void rendersHeadingListTableAndCodeBlockToTerminalFriendlyText() {
        String markdown = """
                # 规划思考

                1. **分析请求**
                - 列出当前目录

                | 名称 | 说明 |
                | --- | --- |
                | src | 源码 |
                | pom.xml | Maven 配置 |

                ```java
                System.out.println("hello");
                ```
                """;

        String rendered = TerminalMarkdownRenderer.render(markdown);

        assertTrue(rendered.contains("规划思考"));
        assertTrue(rendered.contains("1. 分析请求"));
        assertTrue(rendered.contains("- 列出当前目录"));
        assertTrue(rendered.contains("| 名称"));
        assertTrue(rendered.contains("| src"));
        assertTrue(rendered.contains("源码"));
        assertTrue(rendered.contains("┌─ code: java"));
        assertTrue(rendered.contains("└─ end"));
        assertTrue(rendered.contains("    System.out.println(\"hello\");"));
    }

    @Test
    void supportsIncrementalStreamingAppend() {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        java.io.PrintStream stream = new java.io.PrintStream(output);
        TerminalMarkdownRenderer renderer = new TerminalMarkdownRenderer(stream);

        renderer.append("## 标题\n- 第一");
        renderer.append("项\n- 第二项\n");
        renderer.finish();

        String rendered = output.toString();
        assertTrue(rendered.contains("标题"));
        assertTrue(rendered.contains("- 第一项"));
        assertTrue(rendered.contains("- 第二项"));
    }

    @Test
    void preservesNestedListIndentation() {
        String markdown = """
                1. 总体分析
                  - 第一层补充
                    - 第二层补充
                """;

        String rendered = TerminalMarkdownRenderer.render(markdown);

        assertTrue(rendered.contains("1. 总体分析"));
        assertTrue(rendered.contains("  - 第一层补充"));
        assertTrue(rendered.contains("    - 第二层补充"));
    }

    @Test
    void fallsBackToKeyValueLayoutForLongTwoColumnTable() {
        String markdown = """
                | 目录名 | 说明 |
                | --- | --- |
                | src/main/java/com/lyhn/wraith | 这里存放 Wraith CLI 的主要 Java 源码实现与相关模块 |
                """;

        String rendered = TerminalMarkdownRenderer.render(markdown);

        assertTrue(rendered.contains("目录名 / 说明"));
        assertTrue(rendered.contains("- src/main/java/com/lyhn/wraith"));
        assertTrue(rendered.contains("这里存放 Wraith CLI 的主要 Java 源码实现与相关模块"));
    }

    @Test
    void wrapsWideMultiColumnTableInsideTerminalWidth() {
        String markdown = """
                | 特性 | StepFun (Step) | Kimi | GLM | DeepSeek |
                | --- | --- | --- | --- | --- |
                | 基础 URL | https://api.stepfun.com/v1 | https://api.moonshot.ai/v1 | 动态选择（glm-5v用多模态API，其他用编码API） | https://api.deepseek.com/chat/completions |
                | 推理能力 | ✅（需配置 reasoningformat="deepseek-style"） | ✅（需发送推理历史） | ✅ | ✅ |
                """;

        String rendered = TerminalMarkdownRenderer.render(markdown, 72);

        assertTrue(rendered.contains("| 特性"));
        assertFalse(rendered.contains("https://api.deepseek.com/chat/completions |"));
        for (String line : rendered.split("\\R")) {
            String visible = stripAnsi(line);
            assertTrue(visible.length() <= 72, "line exceeds table width: " + visible);
        }
    }
}
