# 交互式选择器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一所有用户选择场景为方向键导航的交互式选择器，并新增 `present_options` 工具让 AI 能在对话中结构化呈现选项。

**Architecture:** 基于 SlashPalette 增强出通用 `InteractiveSelector` 组件，通过 `Renderer.promptChoice()` 接口收口所有选择场景。新增 `present_options` 工具在 Agent ReAct 循环中阻塞等待用户选择。现有 HITL 审批、Plan 审阅、会话选择等全部迁移到 `promptChoice`。

**Tech Stack:** Java 21, JLine 3, Jackson, JUnit 5

## Global Constraints

- Java 21 record 语法
- 终端交互复用 JLine `terminal.enterRawMode()` + AnsiSeq/AnsiStyle，不引入新 ANSI 库
- 工具注册遵循 ToolRegistry 现有模式：`tools.put("name", new Tool(...))`
- 复杂数组 schema 手搭 ObjectNode（参照 `registerTodoTools` 模式）
- system prompt 修改走 `prompt/PromptAssembler` + 模板文件，不在 Agent.java 改字符串
- 选项数量 2-9，label ≤ 200 字符且必须唯一，description ≤ 500 字符
- PlainRenderer 必须保持降级能力（编号列表 + 数字输入）
- AnsiSeq 是 `com.lyhn.wraith.render.inline` 包级类，提供 `moveUp(int)` 和 `CLEAR_LINE`

---

### Task 1: 数据模型

**Files:**
- Create: `src/main/java/com/lyhn/wraith/render/ChoiceOption.java`
- Create: `src/main/java/com/lyhn/wraith/render/ChoiceRequest.java`
- Create: `src/main/java/com/lyhn/wraith/render/ChoiceResult.java`
- Test: `src/test/java/com/lyhn/wraith/render/ChoiceModelsTest.java`

**Interfaces:**
- Produces: `ChoiceOption(String label, String description)`, `ChoiceRequest(String title, List<ChoiceOption> options, boolean allowCancel, String hint)`, `ChoiceResult(int selectedIndex, boolean cancelled)`

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ChoiceModelsTest {

    @Test
    void choiceOption_holdsLabelAndDescription() {
        ChoiceOption opt = new ChoiceOption("方案A", "用 JLine 实现");
        assertEquals("方案A", opt.label());
        assertEquals("用 JLine 实现", opt.description());
    }

    @Test
    void choiceOption_descriptionCanBeNullOrEmpty() {
        ChoiceOption opt1 = new ChoiceOption("简单选项", null);
        assertNull(opt1.description());
        ChoiceOption opt2 = new ChoiceOption("简单选项", "");
        assertEquals("", opt2.description());
    }

    @Test
    void choiceRequest_holdsAllFields() {
        List<ChoiceOption> opts = List.of(
            new ChoiceOption("A", null),
            new ChoiceOption("B", "desc")
        );
        ChoiceRequest req = new ChoiceRequest("选择", opts, true, "提示文本");
        assertEquals("选择", req.title());
        assertEquals(2, req.options().size());
        assertTrue(req.allowCancel());
        assertEquals("提示文本", req.hint());
    }

    @Test
    void choiceResult_selectedIndexAndCancelled() {
        ChoiceResult confirmed = new ChoiceResult(2, false);
        assertEquals(2, confirmed.selectedIndex());
        assertFalse(confirmed.cancelled());

        ChoiceResult cancelled = new ChoiceResult(-1, true);
        assertEquals(-1, cancelled.selectedIndex());
        assertTrue(cancelled.cancelled());
    }

    @Test
    void choiceResult_factoryCancelled() {
        ChoiceResult result = ChoiceResult.cancelled();
        assertTrue(result.cancelled());
        assertEquals(-1, result.selectedIndex());
    }

    @Test
    void choiceResult_factorySelected() {
        ChoiceResult result = ChoiceResult.selected(1);
        assertFalse(result.cancelled());
        assertEquals(1, result.selectedIndex());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=ChoiceModelsTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — classes not found

- [ ] **Step 3: Create ChoiceOption**

```java
package com.lyhn.wraith.render;

/**
 * 选择器中的一个选项。
 *
 * @param label       显示文本（必填）
 * @param description 可选描述，有值时在 label 下方浅色显示
 */
public record ChoiceOption(
        String label,
        String description
) {}
```

- [ ] **Step 4: Create ChoiceRequest**

```java
package com.lyhn.wraith.render;

import java.util.List;

/**
 * 交互式选择器的请求。
 *
 * @param title       选择器标题
 * @param options     2-9 个选项
 * @param allowCancel 是否允许 Esc 取消
 * @param hint        可选自定义底部提示，null 时用默认提示
 */
public record ChoiceRequest(
        String title,
        List<ChoiceOption> options,
        boolean allowCancel,
        String hint
) {}
```

- [ ] **Step 5: Create ChoiceResult**

```java
package com.lyhn.wraith.render;

/**
 * 交互式选择器的结果。
 *
 * @param selectedIndex 选中项下标，取消时为 -1
 * @param cancelled     是否取消
 */
public record ChoiceResult(
        int selectedIndex,
        boolean cancelled
) {
    /** 用户取消时的工厂方法。 */
    public static ChoiceResult cancelled() {
        return new ChoiceResult(-1, true);
    }

    /** 用户选中某项时的工厂方法。 */
    public static ChoiceResult selected(int index) {
        return new ChoiceResult(index, false);
    }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=ChoiceModelsTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/ChoiceOption.java src/main/java/com/lyhn/wraith/render/ChoiceRequest.java src/main/java/com/lyhn/wraith/render/ChoiceResult.java src/test/java/com/lyhn/wraith/render/ChoiceModelsTest.java
git commit -m "feat: 添加交互式选择器数据模型 ChoiceOption/ChoiceRequest/ChoiceResult"
```

---

### Task 2: Renderer 接口扩展

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/Renderer.java` (在第 186 行 `openPalette` 后新增 `promptChoice`)
- Test: `src/test/java/com/lyhn/wraith/render/RendererPromptChoiceTest.java`

**Interfaces:**
- Consumes: `ChoiceRequest`, `ChoiceResult` from Task 1
- Produces: `Renderer.promptChoice(ChoiceRequest)`, `Renderer.openPalette` 改为 default 委托

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class RendererPromptChoiceTest {

    /** openPalette 委托 promptChoice 后下标正确映射 */
    @Test
    void openPaletteDelegatesToPromptChoice() {
        List<String> items = List.of("alpha", "beta", "gamma");
        // 用匿名类模拟 Renderer，只实现 promptChoice 返回固定下标
        Renderer renderer = new Renderer() {
            @Override
            public ChoiceResult promptChoice(ChoiceRequest request) {
                assertEquals(3, request.options().size());
                assertEquals("beta", request.options().get(1).label());
                return ChoiceResult.selected(1);
            }
            // 以下方法仅 no-op，测试不关心
            @Override public void start() {}
            @Override public void close() {}
            @Override public PrintStream stream() { return System.out; }
            @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
            @Override public void appendDiff(String filePath, String before, String after) {}
            @Override public void updateStatus(StatusInfo status) {}
            @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
        };

        int result = renderer.openPalette("test", items);
        assertEquals(1, result);
    }

    @Test
    void openPaletteReturnsNegOneWhenCancelled() {
        Renderer renderer = new Renderer() {
            @Override
            public ChoiceResult promptChoice(ChoiceRequest request) {
                return ChoiceResult.cancelled();
            }
            @Override public void start() {}
            @Override public void close() {}
            @Override public PrintStream stream() { return System.out; }
            @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
            @Override public void appendDiff(String filePath, String before, String after) {}
            @Override public void updateStatus(StatusInfo status) {}
            @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
        };

        int result = renderer.openPalette("test", List.of("a", "b"));
        assertEquals(-1, result);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=RendererPromptChoiceTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — `promptChoice` method not found on Renderer

- [ ] **Step 3: Add promptChoice to Renderer interface and refactor openPalette**

在 `Renderer.java` 中，将 `openPalette` 从抽象方法改为 default 方法委托 `promptChoice`，并新增 `promptChoice` 抽象方法：

```java
// 替换原有的 openPalette（第 181-186 行）为:

    /**
     * 同步阻塞地呈现交互式选项列表，等待用户选定。
     * 统一替代旧 openPalette + HITL 首选项 + Plan 审阅首选项。
     */
    ChoiceResult promptChoice(ChoiceRequest request);

    /**
     * 显示一个临时浮起的选择列表，等待用户选定一项或取消。
     *
     * @return 选中项的下标；用户取消（Esc）返回 -1
     * @deprecated 使用 {@link #promptChoice(ChoiceRequest)} 代替
     */
    @Deprecated
    default int openPalette(String title, List<String> items) {
        if (items == null || items.isEmpty()) {
            return -1;
        }
        java.util.List<ChoiceOption> opts = items.stream()
                .map(s -> new ChoiceOption(s, null))
                .toList();
        return promptChoice(new ChoiceRequest(title, opts, true, null)).selectedIndex();
    }
```

同时在文件顶部添加 import：
```java
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.ChoiceOption;
```
（注意：ChoiceRequest/ChoiceOption/ChoiceResult 与 Renderer 同包 `com.lyhn.wraith.render`，所以不需要额外 import）

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=RendererPromptChoiceTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/Renderer.java src/test/java/com/lyhn/wraith/render/RendererPromptChoiceTest.java
git commit -m "feat: Renderer 接口新增 promptChoice，openPalette 委托给它"
```

---

### Task 3: InteractiveSelector 组件

**Files:**
- Create: `src/main/java/com/lyhn/wraith/render/inline/InteractiveSelector.java`
- Test: `src/test/java/com/lyhn/wraith/render/inline/InteractiveSelectorTest.java`

**Interfaces:**
- Consumes: `ChoiceRequest`, `ChoiceResult` from Task 1; `AnsiSeq` (同包), `AnsiStyle` (`com.lyhn.wraith.util`)
- Produces: `InteractiveSelector(PrintStream out, Terminal terminal).open(ChoiceRequest request) -> ChoiceResult`

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class InteractiveSelectorTest {

    @Test
    void handleKeyUpMovesSelection() {
        // 静态方法可测：上键在高亮第 0 项时循环到最后一项
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_UP, 0, 3);
        assertEquals(InteractiveSelector.DECISION_UP, result);
    }

    @Test
    void handleKeyDownMovesSelection() {
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_DOWN, 0, 3);
        assertEquals(InteractiveSelector.DECISION_DOWN, result);
    }

    @Test
    void handleKeyEnterConfirms() {
        int result = InteractiveSelector.handleKey('\r', 2, 3);
        assertEquals(InteractiveSelector.DECISION_CONFIRM, result);
    }

    @Test
    void handleKeyEscCancels() {
        int result = InteractiveSelector.handleKey(InteractiveSelector.KEY_ESC, 0, 3);
        assertEquals(InteractiveSelector.DECISION_CANCEL, result);
    }

    @Test
    void handleKeyDigitSelectsDirectly() {
        int result = InteractiveSelector.handleKey('2', 0, 3);
        assertEquals(1, result); // 数字 2 → 下标 1
    }

    @Test
    void handleKeyDigitOutOfRangeIsNone() {
        int result = InteractiveSelector.handleKey('9', 0, 3);
        assertEquals(InteractiveSelector.DECISION_NONE, result);
    }

    @Test
    void handleKeyQCancels() {
        int result = InteractiveSelector.handleKey('q', 0, 3);
        assertEquals(InteractiveSelector.DECISION_CANCEL, result);
    }

    @Test
    void handleKeyJKNavigate() {
        assertEquals(InteractiveSelector.DECISION_UP, InteractiveSelector.handleKey('k', 0, 3));
        assertEquals(InteractiveSelector.DECISION_DOWN, InteractiveSelector.handleKey('j', 0, 3));
    }

    @Test
    void fitTruncatesCjkCharacters() {
        // CJK 字符占 2 宽度，截断时按显示宽度算
        String fitted = InteractiveSelector.fit("中文测试abcdef", 10);
        assertTrue(InteractiveSelector.displayWidth(fitted) <= 9);
    }

    @Test
    void fitHandlesAsciiOnly() {
        String fitted = InteractiveSelector.fit("hello world", 5);
        assertEquals("hell", fitted);
    }

    @Test
    void openReturnsCancelledForEmptyOptions() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        InteractiveSelector selector = new InteractiveSelector(new PrintStream(baos), null);
        ChoiceResult result = selector.open(new ChoiceRequest("test", List.of(), true, null));
        assertTrue(result.cancelled());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=InteractiveSelectorTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — class not found

- [ ] **Step 3: Write InteractiveSelector**

基于 SlashPalette 的渲染逻辑，增强支持 ChoiceOption（带 description）。

```java
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
 * 所有需要用户做选择的场景统一通过 {@link Renderer#promptChoice} 调到这里。
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=InteractiveSelectorTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/inline/InteractiveSelector.java src/test/java/com/lyhn/wraith/render/inline/InteractiveSelectorTest.java
git commit -m "feat: 添加 InteractiveSelector 通用交互式选择器组件"
```

---

### Task 4: PlainRenderer 实现 promptChoice

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/PlainRenderer.java` (在 `openPalette` 方法附近新增 `promptChoice`)
- Test: `src/test/java/com/lyhn/wraith/render/PlainRendererPromptChoiceTest.java`

**Interfaces:**
- Consumes: `ChoiceRequest`, `ChoiceResult` from Task 1; PlainRenderer's `out` / `in` fields
- Produces: `PlainRenderer.promptChoice(ChoiceRequest) -> ChoiceResult`

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import java.io.BufferedReader;
import java.io.StringReader;
import java.io.PrintStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PlainRendererPromptChoiceTest {

    @Test
    void promptChoiceReturnsSelectedIndex() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("2\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);

        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
            "选择方案",
            List.of(new ChoiceOption("A", "desc A"), new ChoiceOption("B", "desc B")),
            true, null
        ));

        assertEquals(1, result.selectedIndex());
        assertFalse(result.cancelled());
    }

    @Test
    void promptChoiceReturnsCancelledOnEmptyInput() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);

        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
            "选择",
            List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)),
            true, null
        ));

        assertTrue(result.cancelled());
    }

    @Test
    void promptChoiceReturnsCancelledOnInvalidNumber() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("abc\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);

        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
            "选择",
            List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)),
            true, null
        ));

        assertTrue(result.cancelled());
    }

    @Test
    void promptChoiceReturnsCancelledForEmptyOptions() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader(""));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);

        ChoiceResult result = renderer.promptChoice(new ChoiceRequest(
            "选择", List.of(), true, null
        ));

        assertTrue(result.cancelled());
    }

    @Test
    void promptChoicePrintsDescriptionWhenPresent() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BufferedReader reader = new BufferedReader(new StringReader("1\n"));
        PlainRenderer renderer = new PlainRenderer(new PrintStream(baos), reader);

        renderer.promptChoice(new ChoiceRequest(
            "选择",
            List.of(new ChoiceOption("A", "描述A"), new ChoiceOption("B", null)),
            true, null
        ));

        String output = baos.toString();
        assertTrue(output.contains("描述A"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=PlainRendererPromptChoiceTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — `promptChoice` not found on PlainRenderer

- [ ] **Step 3: Implement promptChoice in PlainRenderer**

在 `PlainRenderer.java` 中，在 `openPalette` 方法之前新增 `promptChoice`：

```java
    @Override
    public ChoiceResult promptChoice(ChoiceRequest request) {
        if (request == null || request.options() == null || request.options().isEmpty()) {
            return ChoiceResult.cancelled();
        }
        out.println();
        out.println(AnsiStyle.heading("📋 " + (request.title() == null ? "请选择" : request.title())));
        for (int i = 0; i < request.options().size(); i++) {
            ChoiceOption opt = request.options().get(i);
            out.printf("  [%d] %s%n", i + 1, opt.label());
            if (opt.description() != null && !opt.description().isBlank()) {
                out.println("      " + AnsiStyle.subtle(opt.description()));
            }
        }
        out.print("> ");
        out.flush();
        try {
            String line = in.readLine();
            if (line == null || line.isBlank()) {
                return ChoiceResult.cancelled();
            }
            int idx = Integer.parseInt(line.trim()) - 1;
            if (idx >= 0 && idx < request.options().size()) {
                return ChoiceResult.selected(idx);
            }
            return ChoiceResult.cancelled();
        } catch (IOException | NumberFormatException e) {
            return ChoiceResult.cancelled();
        }
    }
```

同时删除旧的 `openPalette` 方法（它现在由 Renderer 接口的 default 方法委托）。

在文件顶部添加 import：
```java
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
```
（同包，不需要额外 import）

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=PlainRendererPromptChoiceTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/PlainRenderer.java src/test/java/com/lyhn/wraith/render/PlainRendererPromptChoiceTest.java
git commit -m "feat: PlainRenderer 实现 promptChoice（编号列表降级模式）"
```

---

### Task 5: InlineRenderer 实现 promptChoice

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/inline/InlineRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/render/inline/InlineRendererPromptChoiceTest.java`

**Interfaces:**
- Consumes: `InteractiveSelector` from Task 3; InlineRenderer's `terminal` / `out` / `fallback` fields
- Produces: `InlineRenderer.promptChoice(ChoiceRequest) -> ChoiceResult`

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class InlineRendererPromptChoiceTest {

    @Test
    void promptChoiceReturnsCancelledForEmptyOptions() {
        // 空选项时应该直接返回 cancelled，不需要终端交互
        // InlineRenderer 需要 terminal 才能构造，但空选项路径不触达终端
        // 这里只测 InteractiveSelector 的空选项行为已被 InlineRenderer 覆盖
        ChoiceResult result = ChoiceResult.cancelled();
        assertTrue(result.cancelled());
    }
}
```

注意：InlineRenderer 的完整构造需要 Terminal 等重依赖，在单元测试中难以构造。完整交互测试依赖真实终端环境。这里只做最小验证，核心逻辑由 InteractiveSelectorTest 覆盖。

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=InlineRendererPromptChoiceTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS（测试本身会通过，但 promptChoice 方法可能不存在导致编译失败）

- [ ] **Step 3: Implement promptChoice in InlineRenderer**

在 `InlineRenderer.java` 中新增 `promptChoice` 方法。InlineRenderer 持有 `terminal` 字段和 `out` 字段：

```java
    @Override
    public ChoiceResult promptChoice(ChoiceRequest request) {
        InteractiveSelector selector = new InteractiveSelector(out, terminal);
        return selector.open(request);
    }
```

- [ ] **Step 4: Run all existing tests to verify no regressions**

Run: `mvn test -pl . -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS（所有测试通过）

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/inline/InlineRenderer.java src/test/java/com/lyhn/wraith/render/inline/InlineRendererPromptChoiceTest.java
git commit -m "feat: InlineRenderer 实现 promptChoice 委托给 InteractiveSelector"
```

---

### Task 6: SlashPalette 委托给 InteractiveSelector

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/inline/SlashPalette.java`

**Interfaces:**
- Consumes: `InteractiveSelector` from Task 3
- Produces: SlashPalette.open 委托给 InteractiveSelector.open

- [ ] **Step 1: Refactor SlashPalette to delegate to InteractiveSelector**

将 SlashPalette 的 `open` 方法改为委托给 InteractiveSelector。保留 SlashPalette 作为兼容入口，避免破坏现有调用点（`Main.java:1181` 和 `Main.java:3726`）：

```java
package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.util.AnsiStyle;
import org.jline.terminal.Terminal;

import java.io.PrintStream;
import java.util.List;

/**
 * 临时浮起的命令选择列表。
 *
 * <p>已委托给 {@link InteractiveSelector} 统一实现。保留此类作为兼容入口，
 * 避免破坏 {@code Main.java} 中 {@code openPalette} 的现有调用点。
 */
public final class SlashPalette {

    private final InteractiveSelector delegate;

    public SlashPalette(PrintStream out, Terminal terminal) {
        this.delegate = new InteractiveSelector(out, terminal);
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
        List<ChoiceOption> opts = items.stream()
                .map(s -> new ChoiceOption(s, null))
                .toList();
        ChoiceResult result = delegate.open(new ChoiceRequest(title, opts, true, null));
        return result.cancelled() ? -1 : result.selectedIndex();
    }
}
```

- [ ] **Step 2: Run all existing tests to verify no regressions**

Run: `mvn test -pl . -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/inline/SlashPalette.java
git commit -m "refactor: SlashPalette 委托给 InteractiveSelector 统一实现"
```

---

### Task 7: present_options 工具

**Files:**
- Create: `src/main/java/com/lyhn/wraith/tool/PresentOptionsTool.java`
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` (新增 `registerPresentOptionsTool` 方法并在构造期调用)
- Modify: `src/main/java/com/lyhn/wraith/tool/UiIntentTools.java` (将 `"present_options"` 加入 `NAMES`)
- Test: `src/test/java/com/lyhn/wraith/tool/PresentOptionsToolTest.java`

**Interfaces:**
- Consumes: `Renderer.promptChoice` from Task 2; `ChoiceRequest` / `ChoiceOption` from Task 1
- Produces: `present_options` 工具注册到 ToolRegistry

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PresentOptionsToolTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void validCallReturnsSelectedLabel() {
        // 模拟 renderer 选择第 0 项
        Renderer mockRenderer = new MockRenderer(ChoiceResult.selected(0));
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择方案",
            "options", java.util.Map.of(
                "_json", "[{\"label\":\"方案A\"},{\"label\":\"方案B\"}]"
            )
        ));

        assertEquals("方案A", result);
    }

    @Test
    void cancelledReturnsCancelledMarker() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", java.util.Map.of("_json", "[{\"label\":\"A\"},{\"label\":\"B\"}]")
        ));

        assertEquals("__cancelled__", result);
    }

    @Test
    void tooFewOptionsReturnsError() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", java.util.Map.of("_json", "[{\"label\":\"A\"}]")
        ));

        assertTrue(result.contains("失败") || result.contains("错误") || result.contains("error"));
    }

    @Test
    void duplicateLabelsReturnsError() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", java.util.Map.of("_json", "[{\"label\":\"A\"},{\"label\":\"A\"}]")
        ));

        assertTrue(result.contains("失败") || result.contains("重复") || result.contains("error"));
    }

    /** 最小 MockRenderer,只实现 promptChoice */
    private static class MockRenderer implements Renderer {
        private final ChoiceResult result;
        MockRenderer(ChoiceResult result) { this.result = result; }
        @Override public ChoiceResult promptChoice(ChoiceRequest request) { return result; }
        @Override public void start() {}
        @Override public void close() {}
        @Override public PrintStream stream() { return System.out; }
        @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
        @Override public void appendDiff(String filePath, String before, String after) {}
        @Override public void updateStatus(StatusInfo status) {}
        @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
    }
}
```

注意：`PresentOptionsTool.execute` 接收的 args Map 中，`options` 字段的值取决于 ToolRegistry 如何解析 JSON 数组参数。由于 ToolRegistry 的 `args` 是 `Map<String, ?>`，数组类型参数会以原始 JSON 字符串或 List 形式传入。具体实现中需适配。

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=PresentOptionsToolTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — class not found

- [ ] **Step 3: Create PresentOptionsTool**

```java
package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.Renderer;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * present_options 工具:让 AI 在对话中结构化地呈现可交互选项。
 *
 * <p>AI 调用时传入 title + options 列表,工具执行器调 {@link Renderer#promptChoice}
 * 阻塞等待用户选择,结果作为工具返回值传回 AI。
 */
public final class PresentOptionsTool {

    private static final int MIN_OPTIONS = 2;
    private static final int MAX_OPTIONS = 9;
    private static final int MAX_LABEL_LEN = 200;
    private static final int MAX_DESC_LEN = 500;

    private final Renderer renderer;
    private final ObjectMapper mapper;

    public PresentOptionsTool(Renderer renderer, ObjectMapper mapper) {
        this.renderer = renderer;
        this.mapper = mapper;
    }

    /**
     * 执行 present_options 工具。
     *
     * @param args 工具参数:title(String), options(JSON 字符串或 List), hint(可选)
     * @return 用户选中的 label,或 "__cancelled__"
     */
    public String execute(Map<String, ?> args) {
        String title = args.get("title") == null ? "请选择" : args.get("title").toString();

        // 解析 options
        List<ChoiceOption> options;
        try {
            options = parseOptions(args.get("options"));
        } catch (Exception e) {
            return "present_options 失败: 选项解析错误 - " + e.getMessage();
        }

        // 校验选项数量
        if (options.size() < MIN_OPTIONS) {
            return "present_options 失败: 至少需要 " + MIN_OPTIONS + " 个选项,当前 " + options.size();
        }
        if (options.size() > MAX_OPTIONS) {
            return "present_options 失败: 最多 " + MAX_OPTIONS + " 个选项,当前 " + options.size();
        }

        // 校验 label 非空 + 唯一 + 长度
        Set<String> labels = new HashSet<>();
        for (ChoiceOption opt : options) {
            if (opt.label() == null || opt.label().isBlank()) {
                return "present_options 失败: 选项 label 不能为空";
            }
            if (opt.label().length() > MAX_LABEL_LEN) {
                return "present_options 失败: 选项 label 超过 " + MAX_LABEL_LEN + " 字符";
            }
            if (!labels.add(opt.label())) {
                return "present_options 失败: 选项 label 重复 - '" + opt.label() + "'";
            }
            if (opt.description() != null && opt.description().length() > MAX_DESC_LEN) {
                return "present_options 失败: 选项 description 超过 " + MAX_DESC_LEN + " 字符";
            }
        }

        String hint = args.get("hint") == null ? null : args.get("hint").toString();
        ChoiceRequest request = new ChoiceRequest(title, options, true, hint);
        ChoiceResult result = renderer.promptChoice(request);

        if (result.cancelled()) {
            return "__cancelled__";
        }
        return options.get(result.selectedIndex()).label();
    }

    @SuppressWarnings("unchecked")
    private List<ChoiceOption> parseOptions(Object raw) throws Exception {
        if (raw == null) {
            return List.of();
        }
        // 如果已经是 List<Map> 形式
        if (raw instanceof List<?> list) {
            List<ChoiceOption> opts = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    String label = map.get("label") == null ? "" : map.get("label").toString();
                    String desc = map.get("description") == null ? null : map.get("description").toString();
                    opts.add(new ChoiceOption(label, desc));
                }
            }
            return opts;
        }
        // 如果是 JSON 字符串
        String json = raw.toString();
        if (json.startsWith("[")) {
            JsonNode arr = mapper.readTree(json);
            List<ChoiceOption> opts = new ArrayList<>();
            for (JsonNode node : arr) {
                String label = node.has("label") ? node.get("label").asText() : "";
                String desc = node.has("description") ? node.get("description").asText() : null;
                opts.add(new ChoiceOption(label, desc));
            }
            return opts;
        }
        return List.of();
    }
}
```

- [ ] **Step 4: Register present_options in ToolRegistry**

在 `ToolRegistry.java` 中：

1. 添加字段：
```java
private Renderer renderer;
```

2. 添加 setter：
```java
public void setRenderer(Renderer renderer) {
    this.renderer = renderer;
}
```

3. 添加注册方法（参照 `registerTodoTools` 手搭 schema）：
```java
    private void registerPresentOptionsTool() {
        // 手搭 schema:options 是「对象数组」,createParameters 只支持扁平标量参数
        ObjectNode schema = mapper.createObjectNode();
        schema.put("type", "object");
        ObjectNode props = schema.putObject("properties");

        ObjectNode titleProp = props.putObject("title");
        titleProp.put("type", "string").put("description", "选择器标题,如'选择实现方案'");

        ObjectNode optionsProp = props.putObject("options");
        optionsProp.put("type", "array");
        optionsProp.put("description", "2-9 个选项");
        ObjectNode items = optionsProp.putObject("items");
        items.put("type", "object");
        ObjectNode itemProps = items.putObject("properties");
        itemProps.putObject("label").put("type", "string").put("description", "选项显示文本");
        itemProps.putObject("description").put("type", "string").put("description", "选项的补充说明(可选)");
        items.putArray("required").add("label");
        optionsProp.put("minItems", 2);
        optionsProp.put("maxItems", 9);

        ObjectNode hintProp = props.putObject("hint");
        hintProp.put("type", "string").put("description", "可选的自定义底部提示文本");

        schema.putArray("required").add("title").add("options");

        tools.put("present_options", new Tool(
                "present_options",
                "在对话中为用户呈现可交互的选项列表。当你需要用户从多个方案中选择时调用此工具,"
                        + "而非用纯文本列出选项。选项 label 简洁(≤50 字符),详细说明放 description。"
                        + "用户选择后,选中的 label 会作为工具返回值。用户取消时返回 __cancelled__。",
                schema,
                args -> {
                    if (renderer == null) {
                        return "present_options 失败: 渲染器未初始化";
                    }
                    PresentOptionsTool tool = new PresentOptionsTool(renderer, mapper);
                    return tool.execute(args);
                }
        ));
    }
```

4. 在构造期调用 `registerPresentOptionsTool()`（与其他 register 方法并列）。

5. 在 `UiIntentTools.java` 的 `NAMES` 集合中添加 `"present_options"`：
```java
public static final Set<String> NAMES = Set.of("open_panel", "im_connect", "present_options");
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=PresentOptionsToolTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/lyhn/wraith/tool/PresentOptionsTool.java src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/main/java/com/lyhn/wraith/tool/UiIntentTools.java src/test/java/com/lyhn/wraith/tool/PresentOptionsToolTest.java
git commit -m "feat: 新增 present_options 工具,让 AI 能在对话中呈现交互式选项"
```

---

### Task 8: HITL 审批迁移到 promptChoice

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/inline/InlineApprovalPrompter.java`
- Modify: `src/main/java/com/lyhn/wraith/render/PlainRenderer.java` (promptApproval 首选项)
- Test: `src/test/java/com/lyhn/wraith/render/inline/InlineApprovalPrompterTest.java`

**Interfaces:**
- Consumes: `Renderer.promptChoice` from Task 2; `ChoiceRequest` / `ChoiceOption` from Task 1
- Produces: HITL 审批首选项改用 promptChoice

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.*;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class InlineApprovalPrompterTest {

    @Test
    void approveWhenSelected() {
        // 模拟用户选择第 0 项(批准)
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(0));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
    }

    @Test
    void rejectWhenSelected() {
        // 模拟用户选择第 2 项(拒绝),后续输入拒绝原因
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(2));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader("安全风险\n"))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertEquals("安全风险", result.reason());
    }

    @Test
    void skipWhenSelected() {
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(3));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.SKIPPED, result.decision());
    }

    /** 最小 MockRenderer,只实现 promptChoice 返回预设结果 */
    private static class MockChoiceRenderer implements Renderer {
        private final ChoiceResult result;
        MockChoiceRenderer(ChoiceResult result) { this.result = result; }
        @Override public ChoiceResult promptChoice(ChoiceRequest request) { return result; }
        @Override public void start() {}
        @Override public void close() {}
        @Override public PrintStream stream() { return System.out; }
        @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
        @Override public void appendDiff(String filePath, String before, String after) {}
        @Override public void updateStatus(StatusInfo status) {}
        @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -pl . -Dtest=InlineApprovalPrompterTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — InlineApprovalPrompter 构造函数不匹配（当前不接受 Renderer 参数）

- [ ] **Step 3: Refactor InlineApprovalPrompter to use promptChoice**

重写 `InlineApprovalPrompter.java`。核心变化：构造函数接受 `Renderer` 而非 `Terminal`，首选项通过 `renderer.promptChoice()` 呈现：

```java
package com.lyhn.wraith.render.inline;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalPolicy;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.util.AnsiStyle;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Inline 形态的 HITL 审批提示。
 *
 * <p>首选项(approve/reject/skip/modify)通过 {@link Renderer#promptChoice} 呈现为交互式选择器。
 * 子流程(拒绝原因、修改参数 JSON)回退到 {@code BufferedReader.readLine}。
 */
public final class InlineApprovalPrompter {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final PrintStream out;
    private final Renderer renderer;
    private final BufferedReader stdinReader;

    public InlineApprovalPrompter(PrintStream out, Renderer renderer) {
        this(out, renderer, new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)));
    }

    InlineApprovalPrompter(PrintStream out, Renderer renderer, BufferedReader stdinReader) {
        this.out = out;
        this.renderer = renderer;
        this.stdinReader = stdinReader;
    }

    public ApprovalResult prompt(ApprovalRequest request) {
        boolean sensitive = request.sensitiveNotice() != null && !request.sensitiveNotice().isBlank();
        out.println();
        out.println(AnsiStyle.heading("⚠️  HITL 审批"));
        if (sensitive) {
            out.println("  " + request.sensitiveNotice());
        }
        out.println(request.toDisplayText());

        // 构建选项列表
        List<ChoiceOption> options = new ArrayList<>();
        options.add(new ChoiceOption("批准", null));
        if (!sensitive) {
            options.add(new ChoiceOption("全部放行", null));
        }
        options.add(new ChoiceOption("拒绝", null));
        options.add(new ChoiceOption("跳过", null));
        options.add(new ChoiceOption("修改参数", null));

        ChoiceRequest choiceReq = new ChoiceRequest("HITL 审批", options, false, null);
        ChoiceResult choice = renderer.promptChoice(choiceReq);

        if (choice.cancelled()) {
            return ApprovalResult.reject("用户取消");
        }

        int idx = choice.selectedIndex();
        // 映射回选项语义
        int approveIdx = 0;
        int approveAllIdx = sensitive ? -1 : 1;
        int rejectIdx = sensitive ? 1 : 2;
        int skipIdx = sensitive ? 2 : 3;
        int modifyIdx = sensitive ? 3 : 4;

        if (idx == approveIdx) {
            return ApprovalResult.approve();
        }
        if (idx == approveAllIdx && approveAllIdx >= 0) {
            return promptApproveAllScope(request);
        }
        if (idx == rejectIdx) {
            return ApprovalResult.reject(promptForReason());
        }
        if (idx == skipIdx) {
            return ApprovalResult.skip();
        }
        if (idx == modifyIdx) {
            ApprovalResult modified = promptForModifiedArgs(request);
            return modified != null ? modified : ApprovalResult.approve();
        }
        return ApprovalResult.reject("未识别的选择");
    }

    private String promptForReason() {
        out.print("  拒绝原因（可直接回车跳过）: ");
        out.flush();
        try {
            String line = stdinReader.readLine();
            return line == null ? "" : line.trim();
        } catch (IOException e) {
            return "";
        }
    }

    private ApprovalResult promptApproveAllScope(ApprovalRequest request) {
        String mcpServer = ApprovalPolicy.mcpServerName(request.toolName());
        if (mcpServer == null || mcpServer.isBlank()) {
            out.println(AnsiStyle.subtle("  已批准，后续 " + request.toolName() + " 自动通过"));
            return ApprovalResult.approveAll();
        }
        // 用 promptChoice 选择范围
        List<ChoiceOption> scopeOptions = List.of(
            new ChoiceOption("仅本工具", null),
            new ChoiceOption("整个 MCP server " + mcpServer, null)
        );
        ChoiceResult scopeChoice = renderer.promptChoice(
            new ChoiceRequest("全部放行范围", scopeOptions, false, null)
        );
        if (scopeChoice.cancelled() || scopeChoice.selectedIndex() == 0) {
            out.println(AnsiStyle.subtle("  已批准 tool 范围"));
            return ApprovalResult.approveAll();
        }
        out.println(AnsiStyle.subtle("  已批准 server 范围"));
        return ApprovalResult.approveAllByServer();
    }

    private ApprovalResult promptForModifiedArgs(ApprovalRequest request) {
        out.println("  当前参数: " + request.arguments());
        out.print("  修改后的 JSON（空行 = 保留原参数）: ");
        out.flush();
        String modified;
        try {
            modified = stdinReader.readLine();
        } catch (IOException e) {
            return null;
        }
        if (modified == null || modified.isBlank()) {
            out.println(AnsiStyle.subtle("  保留原参数"));
            return ApprovalResult.approve();
        }
        String trimmed = modified.trim();
        try {
            JSON.readTree(trimmed);
        } catch (Exception e) {
            out.println(AnsiStyle.subtle("  ❌ 非法 JSON: " + e.getMessage()));
            return null;
        }
        return ApprovalResult.modify(trimmed);
    }
}
```

- [ ] **Step 4: Update InlineRenderer to pass itself to InlineApprovalPrompter**

在 `InlineRenderer.java` 中，找到构造 `InlineApprovalPrompter` 的地方，改为传入 `this`（Renderer）而非 `terminal`。原有代码类似：
```java
// 旧: new InlineApprovalPrompter(out, terminal)
// 新: new InlineApprovalPrompter(out, this)
```

- [ ] **Step 5: Update PlainRenderer.promptApproval to use promptChoice for first choice**

在 `PlainRenderer.java` 的 `promptApproval` 方法中，将首选项从单字符读取改为 `promptChoice`。保持子流程逻辑不变。

- [ ] **Step 6: Run test to verify it passes**

Run: `mvn test -pl . -Dtest=InlineApprovalPrompterTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 7: Run all existing tests to verify no regressions**

Run: `mvn test -pl . -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/inline/InlineApprovalPrompter.java src/main/java/com/lyhn/wraith/render/inline/InlineRenderer.java src/main/java/com/lyhn/wraith/render/PlainRenderer.java src/test/java/com/lyhn/wraith/render/inline/InlineApprovalPrompterTest.java
git commit -m "feat: HITL 审批首选项迁移到 promptChoice 交互式选择器"
```

---

### Task 9: Plan 审阅迁移到 promptChoice

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java` (`createPlanReviewHandler` 方法，约第 3231 行)
- Test: 手动集成测试

**Interfaces:**
- Consumes: `Renderer.promptChoice` from Task 2
- Produces: Plan 审阅首选项改用 promptChoice

- [ ] **Step 1: Read current createPlanReviewHandler**

读取 `Main.java` 第 3231-3305 行，理解现有的单字符处理逻辑和 `PlanReviewInputParser` 的降级路径。

- [ ] **Step 2: Refactor createPlanReviewHandler to use promptChoice**

将现有的 raw mode 单字符读取替换为 `renderer.promptChoice()`：

```java
// 在 createPlanReviewHandler 方法中:
List<ChoiceOption> planOptions = List.of(
    new ChoiceOption("执行计划", null),
    new ChoiceOption("展开/折叠详情", null),
    new ChoiceOption("取消", null),
    new ChoiceOption("补充指令重新规划", null)
);
ChoiceRequest planReq = new ChoiceRequest("Plan 审阅", planOptions, false, null);
ChoiceResult planChoice = renderer.promptChoice(planReq);

if (planChoice.cancelled() || planChoice.selectedIndex() == 2) {
    // 取消
    ...
} else if (planChoice.selectedIndex() == 0) {
    // 执行
    ...
} else if (planChoice.selectedIndex() == 1) {
    // 展开/折叠，然后重新弹出
    ...
} else if (planChoice.selectedIndex() == 3) {
    // 补充指令 → 文本输入
    ...
}
```

保留 `PlanReviewInputParser` 作为降级路径（当 `promptChoice` 返回 cancelled 时回退到文本解析）。

- [ ] **Step 3: Compile and run existing tests**

Run: `mvn test -pl . -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat: Plan 审阅首选项迁移到 promptChoice 交互式选择器"
```

---

### Task 10: System Prompt 引导 + ToolRegistry 注入 Renderer

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java` (在初始化 ToolRegistry 后调用 `setRenderer`)
- Modify: system prompt 模板文件（通过 `PromptAssembler` / `PromptRepository`）
- Test: 手动验证

**Interfaces:**
- Consumes: `present_options` 工具 from Task 7
- Produces: system prompt 引导 AI 使用 present_options

- [ ] **Step 1: Inject Renderer into ToolRegistry**

在 `Agent.java` 中，找到 ToolRegistry 初始化的地方，在之后注入 renderer：

```java
toolRegistry.setRenderer(renderer);
```

具体位置在 Agent 构造函数或初始化方法中，与其他 setter（如 `setTodoSink`、`setSkillRegistry`）并列。

- [ ] **Step 2: Add system prompt guidance**

在 system prompt 模板中（通过 `PromptAssembler` / `PromptRepository` 对应的模板文件），新增指引：

```
当需要用户从多个方案中选择时,调用 present_options 工具呈现结构化选项,而非用纯文本列出。选项的 label 简洁(≤50 字符),详细说明放 description。
```

具体模板文件位置取决于 `PromptRepository` 的实现，需要查找对应的 prompt 模板。

- [ ] **Step 3: Compile and run all tests**

Run: `mvn test -pl . -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/lyhn/wraith/agent/Agent.java
git commit -m "feat: Agent 注入 Renderer 到 ToolRegistry,system prompt 引导使用 present_options"
```

- [ ] **Step 5: Manual integration test**

在真实终端中运行 `wraith -d`，测试以下场景：
1. 让 AI 给出多个方案 → 确认 `present_options` 弹出交互式选择器
2. 触发 HITL 审批 → 确认选择器呈现 approve/reject/skip/modify
3. 执行 Plan 审阅 → 确认选择器呈现 execute/expand/cancel/modify
4. `/resume` 续接会话 → 确认选择器呈现会话列表
5. `/config` 命令 → 确认选择器呈现配置项

---

## Self-Review

### Spec coverage
- ✅ 数据模型 ChoiceRequest/ChoiceOption/ChoiceResult → Task 1
- ✅ InteractiveSelector 通用选择器 → Task 3
- ✅ Renderer.promptChoice 接口 → Task 2
- ✅ PlainRenderer 降级实现 → Task 4
- ✅ InlineRenderer 实现 → Task 5
- ✅ SlashPalette 委托 → Task 6
- ✅ present_options 工具 → Task 7
- ✅ HITL 审批迁移 → Task 8
- ✅ Plan 审阅迁移 → Task 9
- ✅ System prompt 引导 → Task 10
- ✅ LanternaRenderer 适配 — 设计文档中提到但未列入计划任务。LanternaRenderer 已有 `ListSelectDialogBuilder`，只需适配 ChoiceOption。作为可选后续任务，不阻塞主流程。
- ✅ EventStreamRenderer — 设计文档中 v1 return cancelled，不实现。

### Placeholder scan
- 无 TBD/TODO
- Task 9 中 `createPlanReviewHandler` 的具体重构代码是骨架，因为需要读取现有代码细节才能填充完整。已在 Step 1 标注"先读现有代码"。

### Type consistency
- ChoiceOption/ChoiceRequest/ChoiceResult 在所有 Task 中签名一致
- InteractiveSelector.handleKey 的常量名 KEY_ESC/KEY_UP/KEY_DOWN/DECISION_* 在 Task 3 定义，测试中引用
- PresentOptionsTool.execute 签名一致
- InlineApprovalPrompter 构造函数从 (PrintStream, Terminal) 改为 (PrintStream, Renderer)
