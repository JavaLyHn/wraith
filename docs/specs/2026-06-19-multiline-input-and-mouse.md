# Spec:多行输入 + 鼠标点击定位

- 日期:2026-06-19
- 状态:已实现并验证(2026-06-19);两处"待真机验证"风险均已用 pty + pyte 复现确认通过(见 §9 末尾)
- 背景:对标 Claude Code 的输入体验。当前 Wraith 的 JLine `LineReader` 是单行的:
  - 只有粘贴(BRACKETED_PASTE)能进多行;键入换行无法做到,写稍长 prompt / 贴代码很别扭。
  - 光标只能用左右键移动定位,不能鼠标点击跳到对应位置。
- 关联评审决定:
  1. **触发方式 = 反斜杠续行 + 换行键**(`\`+Enter 续行;Ctrl+J 插入换行;Enter 提交)。
  2. **鼠标点击定位与多行输入合并实现**(同一 spec)。
  3. **鼠标默认开,带 `WRAITH_MOUSE=off` 开关**。

## 1. 目标 / 非目标

**目标**
- 输入框支持多行:`\`+Enter 续行、Ctrl+J(及尽力支持的 Alt+Enter)插入换行、Enter 提交;粘贴多行照旧。
- 续行/多行 buffer 显示克制对齐的续行提示符(secondary prompt)。
- 提交给 LLM 的是**干净多行文本**(续行 `\` 标记被消费,不残留字面反斜杠)。
- 鼠标左键点击输入区任意位置 → 光标跳到该位置(JLine 内建 `mouse()` widget,**多行/换行/续行提示符感知**)。
- 鼠标行为可用 `WRAITH_MOUSE` 环境变量关闭。

**非目标(本期不做)**
- 外部编辑器模式(`Ctrl+X Ctrl+E` 调 `$EDITOR`)。
- 括号/引号感知的自动续行(只做显式 `\` 续行)。
- 可配置的提交键 / vi 风格多行编辑增强。
- 鼠标拖拽选区、滚轮自定义、右键菜单(只做"左键点击定位")。
- 运行时 `/mouse` 切换命令(本期只用环境变量;后续可加)。

## 2. 触发方式总览

| 操作 | 效果 |
|---|---|
| `\` 然后 Enter | 删掉该 `\`,在原位插入真换行,继续编辑(不提交) |
| Ctrl+J(LF,0x0A) | 在光标处插入真换行,继续编辑(不提交) |
| Alt+Enter(`ESC CR`) | 同 Ctrl+J(尽力支持;见 §5 注意事项) |
| Enter(CR,0x0D) | 提交整段(单行或多行) |
| 粘贴(含多行 / 含 `\`+换行) | 原样进入 buffer,**不触发续行逻辑**,最终 Enter 提交 |
| 鼠标左键点击输入区 | 光标跳到点击位置 |

## 3. 多行输入 — 设计

### 3.1 反斜杠续行:自定义 Enter widget(粘贴安全)

**不采用** JLine `DefaultParser.eofOnEscapedNewLine(true)`。原因:Wraith 是编码 agent,
用户会粘贴含 `\`+换行 的代码(C 宏、shell 续行)。`eofOnEscapedNewLine` + 提交后字符串
归一化无法区分"键入的续行 `\`"与"粘贴的字面 `\`+换行",会误删粘贴代码里的反斜杠。
故 **parser 不改**(保持默认 `DefaultParser`,补全/分词行为零变化)。

改为绑定一个自定义 Enter widget(`wraith-accept-or-continue`),绑到 `\r`(Enter/Ctrl+M),
在 MAIN/EMACS/VIINS keymap:

```java
lineReader.getWidgets().put("wraith-accept-or-continue", () -> {
    Buffer buf = lineReader.getBuffer();
    if (buf.prevChar() == '\\') {        // 光标前一字符是反斜杠 → 续行
        buf.backspace();                 // 删掉该 \
        buf.write('\n');                 // 原位插入真换行
        lineReader.callWidget(LineReader.REDISPLAY);
        return true;
    }
    return lineReader.callWidget(LineReader.ACCEPT_LINE);  // 否则正常提交
});
```

- 粘贴走 BRACKETED_PASTE,整块写入 buffer,**不逐字符过 accept-line**,故粘贴的
  `\`+换行原样保留;只有用户**亲手按 Enter** 且光标前是 `\` 时才消费该 `\`。
- buffer 里直接是干净换行,**无需提交后归一化**(`readPromptInput` 不改)。
- 边界:转义反斜杠 `\\` 后按 Enter → 消费一个 `\`、续行(罕见,可接受)。
  光标在行中按 Enter:按"光标前一字符"判断,符合"键入 `\` 再回车 = 此处换行"的直觉。
- **验证点**:重绑 `\r` 不应破坏补全菜单接受 / 历史搜索接受(这些走 MENU/历史专用
  keymap,MAIN 绑定不参与;需 pty + 真机确认)。

### 3.2 换行键:Ctrl+J(+ 尽力 Alt+Enter)

```java
lineReader.getWidgets().put("wraith-insert-newline", () -> {
    lineReader.getBuffer().write('\n');
    lineReader.callWidget(LineReader.REDISPLAY);
    return true;
});
```

- Ctrl+J = LF(0x0A),Enter = CR(0x0D)→ 重绑 LF **不动** Enter,Enter 仍提交。
  全终端可靠、零修饰键依赖,作为**主推**换行键(文档主写它)。
- Alt+Enter(`\033\r`,及 `\033\n`)**尽力**绑到同一 widget:
  - 默认 ReAct 路径(`allowEscCancel=false`,`Main.java:1399` 直接 `readLine`)能用。
  - Plan/Team 路径(`allowEscCancel=true`)的 Esc-prefill 读取器(`readPrefillInputFromTerminal`)
    会先吃掉 Esc,故 Alt+Enter 在该模式不可用——文档注明,主推 Ctrl+J。
  - 与 `bindEscToClearInput`(Esc 单键清空)并存:JLine 按最长匹配 + Esc 超时消歧,
    已有箭头键 `\033[A` 等多键序列共存先例,加 `\033\r` 一致。

### 3.3 续行提示符(secondary prompt)

- `lineReader.setVariable(LineReader.SECONDARY_PROMPT_PATTERN, <pattern>)`。
- 取克制、与主输入对齐的暗色标记(实现时定:如暗色两格缩进或细 `… `),不喧宾夺主。
- JLine 对**任何**多行 buffer 的后续行都会插入 secondary prompt(`insertSecondaryPrompts`),
  故 `\`续行 与 Ctrl+J 换行 两条路径**显示一致**。

## 4. 鼠标点击定位 — 设计

### 4.1 机制:JLine 内建 `Option.MOUSE` + `mouse()` widget

字节码已确认 JLine 4.0.0 的 `LineReaderImpl.mouse()`:左键释放(`Button1` + `Released`)
时,取当前光标位置 + "带提示符的显示 buffer",应用 tab 宽度、**secondary prompt、列宽换行
拆分**(`columnSplitLength`),再用 `MouseEvent.getX()/getY()` 对 `Cursor` 算出目标 buffer 偏移
并移动光标。**天然多行 / 换行 / 续行提示符感知**,与本 spec 的多行输入完美配合。

```java
if (mouseEnabled(/* WRAITH_MOUSE */) && terminal.hasMouseSupport()) {
    lineReader.option(LineReader.Option.MOUSE, true);
}
```

### 4.2 作用域与代价

- JLine 仅在 `readLine()` 期间 `trackMouse(Normal)`,结束 `finally` 里 `trackMouse(Off)`。
  → **agent 流式输出 / 回看滚动期间,原生鼠标 + 文本选区照常**;劫持只发生在"停在输入提示符"时。
- 停在提示符时的代价:① 拖拽选择/复制**已键入的输入文本**被劫持(macOS 用 ⌥-拖 绕过);
  ② 滚轮在提示符等待期间可能被送进 app 而非终端回滚缓冲(终端相关)。
- **验证点(必须真机 + pyte)**:Wraith 跑自定义 DECSTBM 滚动区 + JLine `Status` 底部 dock
  +(已释放的)banner;`mouse()` 用 `getCursorPosition()` 与渲染 buffer 算坐标,滚动区可能
  让 y 坐标算偏。若真机确认坐标错位且短期修不了 → 退而默认关(`WRAITH_MOUSE` 反转),
  不阻塞多行输入交付。

### 4.3 开关 `WRAITH_MOUSE`

- 默认**开**。`WRAITH_MOUSE` 取 `off` / `0` / `false`(大小写不敏感)→ 关闭。
- 纯函数 `mouseEnabled(String env)` 便于单测。

## 5. 注意事项与边界

- Alt+Enter 在 Plan/Team 模式不可用(Esc-prefill 截断);主推 Ctrl+J。
- 鼠标模式仅在 `terminal.hasMouseSupport()` 为真时启用;dumb / 不支持时静默跳过。
- 多行历史:JLine 原生支持多行 history entry,recall 后恢复为多行(沿用默认行为)。
- 极长多行输入接近屏高:JLine 自管重绘/滚动,本期不特殊处理。
- 不改 `prompts/base.md`(这是面向用户的输入 UX,非面向 LLM 的能力)。

## 6. 代码触点

1. `Main.java`(建 `LineReader` 处,~270)——build 后依次:
   - `bindEnterContinuation(lineReader)`:`\r` → `wraith-accept-or-continue`(§3.1)。
   - `bindNewlineKey(lineReader)`:`\n`(+ 尽力 `\033\r`/`\033\n`)→ `wraith-insert-newline`(§3.2)。
   - `setVariable(SECONDARY_PROMPT_PATTERN, …)`(§3.3)。
   - `enableMouseIfAvailable(terminal, lineReader)`:读 `WRAITH_MOUSE` + `hasMouseSupport`(§4)。
   - 复用已有 `bindKeyToWidget(...)` 辅助(`Main.java:1865`)。
2. `Main` 新增静态辅助:`bindEnterContinuation`、`bindNewlineKey`、`enableMouseIfAvailable`、
   纯函数 `mouseEnabled(String)`(放在现有 `bind*ToWidget` 辅助群附近,~1865–2210)。
3. **不改** `readPromptInput`(§3.1 已无需归一化)、**不改** parser、**不改** `base.md`。
4. `README.md`:快捷键/输入说明补 `\`+Enter / Ctrl+J 换行、Enter 提交、鼠标点击定位 +
   `WRAITH_MOUSE` 开关。

## 7. 验证计划

- 纯函数单测:`mouseEnabled(String)`(on/off/0/false/null/大小写)。
- pty + pyte 端到端(沿用本项目既有手法:`pty.fork` + winsize + 启动后键入 + pyte 网格断言):
  - `line1\`↵`line2`↵ → 提交文本为 `line1\nline2`(无残留 `\`);续行提示符渲染;底部 dock 不被顶飞。
  - `abc` + Ctrl+J(0x0A) + `def` ↵ → 多行提交。
  - 粘贴含 `\`+换行 的块 + Enter → 反斜杠**原样保留**(回归断言,守 §3.1 粘贴安全)。
  - 注入鼠标 SGR 序列(如 `\033[<0;c;rM`/`m`)模拟点击 → 光标移到目标格(可能需真机手验补充)。
- 真机手验:iTerm/Terminal 点击多行输入定位;确认滚动区/dock 坐标不偏;`WRAITH_MOUSE=off` 生效。

**实际验证结果(2026-06-19,pty.fork + pyte 网格断言)**
- ✅ `\`+Enter 续行:`line1\`↵`line2` → 续行(光标在第 2 行、未提交),`\` 已消费,续行提示符
  `│` 竖线连续对齐,dock 不被顶飞;提交后回显用户块为干净 `line1` / `line2`(无 `\`)。
- ✅ Ctrl+J(0x0A)插入换行:`abc`+Ctrl+J+`def` → 两行,提交回显 `abc` / `def`。
- ✅ 粘贴安全(回归):bracketed-paste `xx\`+换行+`yy` → `\` **原样保留**,提交回显 `xx\` / `yy`。
- ✅ 鼠标点击定位:点击 `hello world` 的 `h`(屏列 5)→ 光标从 x=16 跳到 **x=5**,**自定义滚动区
  + dock 下坐标无偏**(§4.2 风险解除;驱动端需应答 DSR `ESC[6n` 才能跑通,真机由终端自答)。
- ✅ `WRAITH_MOUSE=off`:不发鼠标追踪序列(`ESC[?1000h` 等);默认开时发。
- ✅ Enter 重绑不破坏补全:`/cl`+Tab → 补全为 `/clear`,Enter 正常执行命令(§3.1 验证点解除)。

## 8. 开放问题(已在实现时定)

1. secondary prompt 样式 → **定为** ` │   `(暗色 `│` + 3 空格,与主提示符 ` │ › ` 等宽 5 列,
   `│` 竖线在多行间连续,与 dock 下线同列)。由 `Renderer.continuationPrompt()` 提供,
   `InlineRenderer` 重写,无色终端降级为纯空格对齐。
2. Alt+Enter → **绑了**(`KeyMap.alt('\r')` / `alt('\n')`);ReAct 可用,Plan/Team 受 Esc-prefill
   限制(文档主推 Ctrl+J)。未见体感延迟。
3. 鼠标与滚动区坐标 → **验证无冲突**(§9),`WRAITH_MOUSE` 默认保持开。
