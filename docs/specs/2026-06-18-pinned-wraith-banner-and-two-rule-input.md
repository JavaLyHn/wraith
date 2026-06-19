# Spec — 常驻顶部 WRAITH banner + 两横线输入框

- 日期:2026-06-18
- 作者:LyHn
- 分支:`feat/adaptive-resize-header`(`main` 保持稳定)
- 状态(2026-06-18 真机迭代后):
  - **Phase 1 输入框** — ✅ **左下半框**(`│` 提示符 + dock 自绘 `╰────` 下线,同列对齐)。`InlineInputBoxTest` 6/6。
  - **Phase 2 常驻冻结 banner** — ✅ **已恢复**(用户明确要求 banner 钉死左上角)。DECSTBM 冻结 **字标 + 信息行**(H=11),`PinnedBanner` + 滚动区接管(`reassertTopScrollRegion`)+ 去抖监视线程处理 resize。**Tips 不进固定区**,改走 `printAbove` 进滚动区随对话滚走。

## 关键教训:Tips 不能进固定区

中途曾把 Tips 也钉进固定区,导致**启动后滚动区为空**;JLine 在 resize 后用 `doDisplay()` 重建 `Display`,空滚动区下输入行会被锚到屏幕顶部、压在 banner 上(实测 bug)。把 Tips 留在滚动区(非空)规避了这一点。

> 仍存在的 JLine 约束:`LineReaderImpl` resize 时重建 `Display`、`Status` 由 `AbstractTerminal` 内部构造(无法注入子类),所以"冻结 banner + JLine 输入"在 resize 边角仍可能有瑕疵,靠监视线程 + `beforeInput` 补画兜底。下方 Plan A·B 细节为历史记录。
- 取代:`docs/specs/2026-06-18-adaptive-resize-pinned-header.md`(那是 option-2 规划稿;本稿是经用户拍板的具体落地版,字标改为**完整 banner 常驻**而非 2 行紧凑条)

---

## 1. 目标

对标 Claude CLI 的两点:

1. **完整 WRAITH banner 常驻屏幕左上角**,且**终端 resize 时始终保持在左上角**、不产生乱码。今天 banner 是用 `LineReader.printAbove()` 打到 scrollback 里的,会随对话滚走;目标是把它冻结在顶部固定区。
2. **输入框改为"两横线"样式**:输入内容夹在上下两条 `─` 之间,提示符由 `* ` 改为 `› `,替换当前裸 `* prompt` 形态。

用户已知并接受代价:完整 banner 常驻会**永久占用约 7–8 行**纵向空间;终端过小则自动降级(见 §7)。

## 2. 决策记录(已拍板)

- 顶部:**完整 banner 常驻**(非紧凑 1/2 行条)。
- 输入框:**两条横线**(上 `─` / `› 输入` / 下 `─` / 提示行),非全包围圆角框。
- 滚动区策略:**先试 Plan A(与 JLine Status 共存),不稳则退到 Plan B(接管上下两个固定区)**。见 §5.2。
- 节奏:**分两阶段**——Phase 1 输入框(低风险),Phase 2 常驻 banner(滚动区改造)。
- 验证:Phase 2 的冻结 + resize 行为**无法 headless 验证**,需真实 TTY 与用户迭代 2–3 轮。

## 3. 目标布局(任意尺寸、任意时刻)

```
   ██╗    ██╗██████╗  █████╗ ██╗████████╗██╗  ██╗     ┐
   ██║    ██║██╔══██╗██╔══██╗██║╚══██╔══╝██║  ██║     │
   ██║ █╗ ██║██████╔╝███████║██║   ██║   ███████║     │  冻结顶部固定区
   ██║███╗██║██╔══██╗██╔══██║██║   ██║   ██╔══██║     │  (行 1..H,resize 后重绘)
   ╚███╔███╔╝██║  ██║██║  ██║██║   ██║   ██║  ██║     │
    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝     │
    Wraith CLI · v16.1.0 · DeepSeek-V4-Flash          │
   ────────────────────────────────────────────────  ┘
   (transcript 在此滚动:对话、工具调用块、diff)        ← 滚动区
   ────────────────────────────────────────────────  ┐ 输入框
    › 你的消息_                                        │ (两横线)
   ────────────────────────────────────────────────  ┘
    YOLO Ctrl+Y · model · ctx ▓░ 12% · ~/path         ← 底部 dock(JLine Status)
```

- banner 左对齐(保留现有 `   ` 三空格缩进),不居中——契合"左上角"。
- `H` = banner 行数(6)+ 文案行(1)+ 分隔线(1)= **8 行**(随实现微调;以 `PinnedBanner.height()` 为准)。

## 4. 现状基线(已核对源码)

| 关注点 | 现状 | 位置 |
|---|---|---|
| banner 内容 | `startupBannerLines(info)` 生成,`AnsiStyle.wordmark` 白色 6 行 + 信息行 | `cli/Main.java:2886` |
| banner 打印 | `installStartupScreen()` 挂 `CALLBACK_INIT` → `printAbove()`(进 scrollback,会滚走) | `render/inline/InlineRenderer.java:217` |
| 输入提示符 | `inputPrompt()` 返回 `"* "`;`readLine(prompt, rightPrompt,…)` | `InlineRenderer.java:119`、`Main.java:1228` |
| 提交后清理 | `clearAcceptedInput()` / `acceptedInputRows()` 用 `inputPrompt()` 宽度算行数 | `InlineRenderer.java:240,507` |
| 底部 dock | `BottomStatusBar` 包 JLine `Status`,`setBorder(true)`(dock 上方已有一条边框线) | `render/inline/BottomStatusBar.java` |
| 滚动区 | **JLine `Status` 独占**(`top=1`);`AnsiSeq.setScrollRegion(top,bottom)` 已存在但未用于顶部 | `AnsiSeq.java:49` |
| resize | `render/` **无任何 WINCH/resize 处理**;改大小→满屏碎片 | — |
| 既有件 | `feat/adaptive-resize-header` 已有 `TopHeader.java`(2 行紧凑条,纯函数) | 分支上 |

## 5. 架构与组件

### 5.1 新增/改动文件

| 文件 | 职责 | 阶段 |
|---|---|---|
| `render/inline/PinnedBanner.java`(由 `TopHeader.java` 泛化或新建) | 纯函数 `render(int cols, …)` → 完整 banner 行(无 ANSI);`height()` | P2 |
| `render/inline/InlineRenderer.java` | 接管顶部固定区:启动设滚动区、绘 banner、WINCH 重绘;输入框两横线提示符;修 `acceptedInputRows` 行数 | P1+P2 |
| `render/inline/BottomStatusBar.java` | (Plan A)暴露"重绘后回调"以便 re-assert 顶部;(Plan B)改为手写 dock | P2 |
| `cli/Main.java` | banner 不再走 `installStartupScreen`(改由顶部固定区绘);prompt/rightPrompt 文案;注册 WINCH | P1+P2 |
| `util/AnsiStyle.java` | 输入框横线 / 提示行样式(必要时) | P1 |

### 5.2 滚动区策略:Plan A → Plan B

冻结顶部 = 设 `ESC[H+1;bottom r`,使行 `1..H` 不被滚动覆盖。难点:JLine `Status` 自己管滚动区(`top=1`)且在更新时 re-assert。

- **Plan A(先试,代码少、脆):** 保留 JLine `Status` 管底部 dock;我在它每次 dock 更新后 + WINCH 后**重新下发 `setScrollRegion(H+1, rows-dockH)`**,并用 save/restore cursor 在 `1..H` 行绘 banner。风险:JLine 内部光标行号按 `top=1` 假设,dock 可能错位——只能真机验证。
- **Plan B(兜底,代码多、稳):** 不再用 JLine `Status`;`InlineRenderer` 手写上下两个固定区——`setScrollRegion(H+1, rows-dockH)`,顶部绘 banner、底部绘 dock(复用 `BottomStatusBar.formatStatusLines` 的格式化逻辑,只换输出方式),正文 `printAbove` 仍在滚动区内工作。

判定门槛:Plan A 在真机上 dock 不错位、resize 干净 → 采用;否则切 Plan B。两者都在分支上,`main` 不动。

### 5.3 WINCH(resize)处理

注册 `terminal.handle(Terminal.Signal.WINCH, sig -> …)`:
1. 重算 `rows/cols`、`H`、`dockH`;
2. 重设滚动区 `setScrollRegion(H+1, rows-dockH)`;
3. 按新 `cols` 重绘 banner(分隔线宽度随之变化);
4. 重绘 dock;
5. 触发 `LineReader` redisplay(光标/输入行回到滚动区内)。

边界:已滚出屏幕的历史在 resize 时由终端自行重折行,任何 CLI 都无法还原——只保证**活动区(banner + 滚动区 + dock)干净自适应**。

## 6. 输入框 — Phase 1

> **最终设计(2026-06-18,真机迭代后):左下半框。**
>
> **硬约束(读 JLine 源码 + 真机确认)**:输入行由 JLine `readLine` 绘制,JLine 永远把输入行画在"底部保留区(dock)的正上方"。于是输入行**下方**能稳定画线(保留区自管、resize 不散),**上方**则落在 JLine 的输入重绘区/滚动区里——任何画在那儿的整宽线 resize 时都被 reflow 打散(就是早先满屏 `─` 残影的来源)。要让输入**上方**也有稳定线,只能自绘整个输入行(放弃 JLine 的历史/补全/多行/@/slash),代价过大,不做。
>
> 因此采用**左下半框**(用户拍板):
> - 提示符 = {@code  │ › }:行首暗灰竖线 `│`(单字符,不随 resize 散)。
> - dock 关掉 JLine 默认边框(`setBorder(false)`),由 `BottomStatusBar.boxBottomRule(cols)` 自绘 {@code  ╰────} 作为输入框下线;`╰` 与输入行 `│` **同列(第 2 列)对齐**,构成左下半框。
> - dock 物理行数仍为 3(下线 + 状态 + footer);`formatStatusLines` 仍返回 2 行(状态/footer),下线在 `renderDock` 里单独 prepend,故 `BottomStatusBarTest` 的 `size()==2` 契约不变。
> - 行宽计算:`submittedInputRows(input, displayWidth(" │ › ")=5, leadingLines=0, cols)`。

### 历史设计(已废弃的整宽两横线方案)

- `inputPrompt()`:`"* "` → 多行提示符 `<上横线>\n› `(JLine 支持多行 prompt;横线宽度取 `terminalColumns()`)。
- 下横线:复用 dock 既有边框线(`setBorder(true)`)。
- 提示文案:`inputRightPrompt()` / 提示行改为 `⏎ send · / commands · @ files · ⇥ complete`(具体并入 right-prompt 或 dock 行,实现时定)。
- **必须同步**:`acceptedInputRows()` 与 `clearAcceptedInput()` 的行数计算——提示符从 1 行变多行后,提交后清理要多算上横线那一行,否则屏幕残留/错位。
- 提示符 `›`/横线颜色复用 `AnsiStyle`(白/暗),与 banner 白色协调。

## 7. 降级(banner 永不撑爆终端)

满足全部才启用冻结 banner;否则回退到**今天的 `printAbove` scrollback banner**(滚走,不冻结):

- `TerminalCapabilities.supportsScrollRegion(terminal)` 为真(含真 TTY、非 dumb、`rows≥5`);
- 且 `rows ≥ H + dockH + 3`(给滚动区留至少 3 行可视空间);
- 未设 `WRAITH_NO_STATUSBAR` / `wraith-cli.no.statusbar`。

降级时输入框两横线仍生效(Phase 1 与滚动区无关)。

## 8. 测试

- **纯函数单测**:
  - `PinnedBanner.render(cols)`:行数 = `height()`、每行 ≤ cols、窄宽截断/降级返回空;
  - 输入框行数:多行提示符下 `acceptedInputRows()` 对单/多行输入、含中文宽字符的计数;
  - 降级真值表:`rows`/`cols`/能力位组合 → 冻结 or 回退。
- **回归**:`MainInputNormalizationTest`(banner 内容/字节级)随 prompt 改动更新预期。
- **无法 headless 验证(真机人工)**:滚动区冻结、WINCH 重绘、dock 不错位、两横线在真实 resize 下的表现。
- JDK 26 + Mockito 对 JLine `Terminal` 的已知冲突仍在 → 默认 `skipTests` 打包,定向跑纯函数测试。

## 9. 风险

- **滚动区争用(最高)**:Plan A 与 JLine `Status` 抢 DECSTBM,可能 dock 错位/光标乱跳;缓解 = Plan B 兜底。
- **不可 headless 验证**:Phase 2 需真机迭代,预留 2–3 轮。
- **改动面**:`InlineRenderer`(~728 行)+ 可能 `BottomStatusBar`(~445 行);分支隔离,`main` 稳定。
- **纵向占用**:完整 banner 吃 ~8 行,小终端体验差——靠 §7 降级兜底。
- banner 不再走 `installStartupScreen`/`printAbove`,需确认 `startupScreenPrinted` 等相关逻辑不悬挂。

## 10. 分阶段交付

- **Phase 1 — 两横线输入框**(低风险、可视):prompt 改造 + 行数计算 + 文案 + 纯函数测试。可单独合并。
- **Phase 2 — 常驻 banner + resize**(高风险、需真机):`PinnedBanner` + 滚动区接管(A→B)+ WINCH + 降级。真机迭代后合并。

---

## 11. 实现笔记 — Plan A(已落地)

读 JLine 4.0.0 `org.jline.utils.Status` 源码后确认的关键事实,决定了 Plan A 怎么写:

- `Status` 把滚动区**顶边硬编码为 0**,`change_scroll_region(0, bottom)`;`bottom`(0-based)= `rows - 1 - lines.size()`,`lines` 含 `setBorder(true)` 的边框行 → dock 共 **3 行**(2 状态 + 1 边框),即 `bottom0 = rows - 4`。
- `Status` **只在状态行数变化 / resize / reset 时**重发 `change_scroll_region`;稳态 `update()` 不动滚动区。本项目 `formatStatusLines` 恒为 2 行,故启动后行数恒定 → 顶边一旦设好就不会被 JLine 改回去(除 resize)。

落地方式:
- **固定区范围(已拍板)**:字标 6 行 + 信息行 4 行 + 分隔线 1 行 = **H = 11**;Tips 滚进历史。
- **顶边纠正**:`BottomStatusBar.renderDock()` 在每次 `dock.update()` 后调 `reassertTopScrollRegion()`,用 save/restore cursor 包裹,把顶边设回 `change_scroll_region(H, rows-4)`。这是单一咽喉点,覆盖"首次 0→3 增长"与任何行数变化。
- **banner 绘制**:`InlineRenderer.paintBanner()` 在 0..H-1 行绝对定位绘制(save/restore cursor + clr_eol),仅在 engage / WINCH / 每轮 `beforeInput` 触发,流式期间不重画(免闪)。
- **WINCH**:`terminal.handle(WINCH, …)` → `statusBar.resize()`(JLine 重算 + 重设固定区)+ `paintBanner()`。
- **降级**:不支持滚动区 / `rows < H + dock(3) + 3` / `WRAITH_NO_PINNED_BANNER`(或 `-Dwraith-cli.no.pinned.banner`)→ 不固定,banner 走老的滚动历史路径。

### resize 期间的 WINCH 归属(关键修复)
读 `LineReaderImpl` 源码确认:`readLine` 期间它把 WINCH 处理器换成自己的(line 677),WINCH 时调 `status.resize()` 把滚动区**顶边重置回 0**、重排,且全程不触达我们的代码——所以"在 prompt 处拉伸窗口"会让 banner 消失(实测 bug)。`Status` 由 `AbstractTerminal` 内部 `new` 出来,**无法注入子类**,JLine 也没有可挂的 redisplay 钩子。

修复:**去抖尺寸监视线程**(`startResizeWatcher`)。轮询 `terminal.getSize()`(它反映 OS 真实尺寸,与 JLine 信号归属无关),尺寸稳定一拍后调 `onResize()` 重建固定区 + 重画 banner。与 WINCH 处理器幂等;`BottomStatusBar.resize()` 在尺寸未变时是 no-op,重复调用安全。延迟约 2×120ms。

### 已知限制(Plan A 固有,需真机判定是否可接受)
- **已滚出屏幕的历史**:resize 时由终端自行重折行,任何 inline CLI 都无法还原;只保证活动区(banner + 滚动区 + dock + 输入框)在尺寸稳定后干净重绘。
- **拖动过程中**:监视线程等尺寸稳定才重绘(~240ms),拖动中途可能短暂错位,松手后恢复。
- **启动初期**:engage 在 MCP 启动输出之后发生,固定区那几行的早期 MCP 文本会被 banner 覆盖(光标用 save/restore 保护,滚动区内文本不丢)。
- **整宽分隔线**:`─` 取满列宽,依赖终端 deferred-wrap;若真机出现多折一行,改 `cols-1`。

## 12. 验收标准

- [ ] 输入框:输入夹在上下两条 `─` 之间,提示符 `› `,无 `* `。
- [ ] 提交后无重复行/残留(行数计算正确)。
- [ ] 完整 WRAITH banner 固定在左上角,对话滚动时不被覆盖。
- [ ] 终端 resize 后 banner 仍在左上角、分隔线宽度自适应、活动区无乱码。
- [ ] 小终端/非 TTY 自动降级到滚动 banner,不报错、不撑爆。
- [ ] `main` 全程可编译;纯函数单测通过。

---

## 13. 本次交付总结(最终,2026-06-18)

样式打磨到此告一段落(用户决定"CLI 样式设计先不管了")。以下是**实际落地的现状**,作为本次工作的记录。

### 已交付(代码现状)
- **开场动画 + 白色 WRAITH 字标**:启动播三段式动画,字标白色(早先轮次,已稳定)。
- **常驻顶部 banner**:WRAITH 字标 + 信息行(Wraith CLI / Model / 状态 / 能力,`H=11`)经 DECSTBM 冻结在左上角,对话滚动时不被覆盖。组件:`render/inline/PinnedBanner.java`;滚动区接管 + 顶边纠正在 `BottomStatusBar`;去抖尺寸监视线程在 `InlineRenderer`。
- **Tips 走滚动区**:不进固定区(经 `printAbove`),随对话自然滚走——**刻意保持滚动区非空**,以规避"空滚动区下 resize 后输入误锚顶部"。
- **输入框左下半框**:提示符 `│ › `(暗灰左竖线),配合 dock 自绘的 ` ╰────` 下线(`╰` 与 `│` 同列对齐)。关掉了 JLine 默认边框。
- **降级**:不支持滚动区 / 终端过矮 → 自动回退到滚动 banner,不报错。

### 测试
- 纯函数单测(JDK 26 下可跑):`PinnedBannerTest`(3)、`InlineInputBoxTest`(6)、`BottomStatusBarTest` 的 `formatStatusLines` 用例(2)——全绿。
- `mvn clean package` 通过,产物 31M uber-jar。
- Mock-`Terminal` 的测试在 JDK 26 + Mockito 下无法执行(既有环境限制),默认 `skipTests` 打包。

### 已知限制 / 未决
- **resize 边角**:`readLine` 期间 WINCH 由 JLine 接管、它在 resize 后用 `doDisplay()` 重建 `Display`(`cursorPos=0`,把输入行锚到屏顶),与"冻结 banner"天生有摩擦。靠监视线程 + `beforeInput` 补画兜底,**真机可能仍有 resize 瞬时瑕疵**(未由用户最终确认)。
- **彻底消除 resize 瑕疵**需"自绘行编辑器"(放弃 JLine `readLine`,自行处理历史/补全/多行/@//面板/粘贴/宽字符)——评估为大工程、高回归风险,**本次未做**,留待后续按需决策。
- `render/inline/TopHeader.java`(早先 2 行紧凑条)已被 `PinnedBanner` 取代,为历史遗留,未删除。

### 关键技术结论(供后续参考)
- JLine 4.0.0 `Status` 把滚动区顶边硬编码为 0,仅在状态行数变化 / resize / reset 时重发 `change_scroll_region`;`Status` 由 `AbstractTerminal` 内部构造,无法注入子类。
- `LineReaderImpl` resize 时重建 `Display`,输入行锚到 `cursorPos=0`(屏幕绝对顶部),这是"冻结顶部 banner"与 JLine 的根本摩擦点。
