# Spec — 启动开场动画 + WRAITH 字标白化 + (规划)自适应顶栏

- 日期:2026-06-18
- 作者:LyHn
- 状态:
  - **A 每次启动播动画** — ✅ 已实现并测试
  - **C 静态 WRAITH 字标改白色** — ✅ 已实现并测试
  - **B 自适应 resize + 顶部常驻 WRAITH 标识(option 2)** — 🔶 已定方向,**未实现**(待按本规范落地;顶栏内容 1/2/3 行待定)

---

## 1. 目标

打开终端运行 `java -jar wraith-1.0-SNAPSHOT.jar` 时,先播一段黑底纯白的 WRAITH 开场动画,再进入正常 banner / 交互。动画形态对应需求提示词:

> 黑底纯白;多条白色横向扫描线自上而下、在中间裂开;扫描线溶解淡出的同时大号 `WRAITH` 逐步显现并铺满屏宽;最后巨大的纯白 `WRAITH` 在黑屏上左右摆动。

终端无真 alpha,"淡出/溶解"用密度字符近似;"铺满屏宽"在终端等宽字形限制下落地为"按当前列宽居中显示能容纳的最大字标"。

## 2. 触发与降级(IntroGate)

- **每次启动都播**(满足能力条件):`inline` 渲染器 + 颜色启用 + 真 TTY + 终端列宽 ≥ `MIN_COLUMNS`(50)。
- `WRAITH_INTRO=off`(或 `false`/`0`)关闭。
- 任意按键中止动画,直接进静态 banner。
- 不满足能力条件(非 inline / `NO_COLOR` / 管道/CI 非 TTY / 终端过窄)→ 静默跳过,只显示静态 banner。
- 纯函数签名:`IntroGate.shouldPlay(inline, colorEnabled, realTty, columns, introEnv)`。

## 3. 动画(IntroAnimation,三段式)

画布 = 字标高度(6 行)× 当前列宽;ANSI 光标上移就地重绘逐帧;**不进 alt-screen**(保留 inline 的 transcript 模型);结束清理画布,不留滚动残影。逐帧由纯函数 `frames(int cols)` 生成(无 ANSI,便于单测),`play(Terminal)` 负责 raw 模式 / 节奏 / 按键跳过 / 颜色。

| 段 | 帧数 | 效果 |
|---|---|---|
| 1 扫描 | 7 | 整宽白线自上而下扫,带一行变暗(`▒`)拖尾 |
| 1b 裂开 | 6 | 中线从中间裂开,两半向两侧退去 |
| 2 显现 | 12 | 字标自左向右逐列擦出(扫描线此时已退场=溶解) |
| 3 摆动 | 9 | 整块字标按 `{2,1,0,-1,-2,-1,0,1,0}` 平移摆动后回正;末帧=居中字标 |

- 帧速 `FRAME_MS = 38ms`,总时长 ~1.3s。
- 颜色:纯白(`ESC[1;97m`)。
- 边界:`width()+2 > cols` 时不出帧(返回空)。

## 4. 静态 banner 字标白化(C)

- 新增 `AnsiStyle.wordmark(text)` = 粗体 + 亮白(`ESC[1;97m`)。
- banner 的 6 行字标 + `Wraith CLI` 文案由原来的 `AnsiStyle.section`(绿)改为 `AnsiStyle.wordmark`(白)。
- 信息行(model / MCP / 能力)仍为青色高亮(`AnsiStyle.heading`)。
- 与开场动画的白色保持一致。

## 5. 架构(文件)

| 文件 | 职责 |
|---|---|
| `render/WraithWordmark.java` | 共享字标常量(6 行)+ `width()`/`height()`;banner 与动画共用,消除重复 |
| `render/intro/IntroGate.java` | 纯函数 `shouldPlay(...)`:是否播放 |
| `render/intro/IntroAnimation.java` | `frames(int cols)`(纯)+ `play(Terminal)`(I/O / raw / 跳过) |
| `cli/Main.java` | `playIntroIfEnabled(terminal, renderer)`,挂在 `renderer.start()` **之前** |
| `util/AnsiStyle.java` | 新增 `wordmark(...)` 白色样式 |

## 6. 测试与验证

- 单测:`IntroGateTest`(shouldPlay 真值表)、`IntroAnimationFramesTest`(帧非空 / 每行 ≤ cols / 末帧=居中字标 / 太窄不出帧)、`MainInputNormalizationTest`(banner 内容不变,字节级一致)。
- 已验证:`mvn package` 通过;headless 启动非 TTY 时动画正确跳过、banner 字标渲染为 `ESC[1;97m`(白)。
- **无法在 headless 自动验证**:真实逐帧动画与 resize 行为需要交互式 TTY,只能在真实终端人工确认。

## 7. 风险

- 动画是非关键路径:`play()` 全程 try/finally,任何终端异常都静默退场,不阻塞启动。
- raw 模式进入/恢复用 `enterRawMode()`/`setAttributes()` 兜底。
- 已滚出屏幕的历史在终端 resize 时由终端自行重折行,任何 CLI 都无法还原。

---

## 8. (规划)B — 自适应 resize + 顶部常驻 WRAITH 标识(option 2)

> 现状缺陷:`render/` **无任何 SIGWINCH/resize 处理**,改终端大小会满屏碎片(见 `截屏2026-06-18 11.30.55`)。

**目标**:像 Claude CLI 一样——顶部常驻一个紧凑 WRAITH 标识(始终可见、resize 自适应),活动 UI(顶栏 + 底部 dock + 输入区)在 resize 时干净重绘、不再乱码。

**待定决策**:顶栏内容/高度 —— ① 1 行细条 `▌ WRAITH · vX · model`(推荐);② 2 行(小标 + 细线);③ 3 行紧凑 block。

**技术路线(高风险,需独立分支 + 真实终端迭代)**:
- 顶栏要与 JLine 底部 `Status` dock 共存,而 `Status` 自管滚动区(top=1)。需在 inline 渲染器中**接管上下两个固定区**(改为手动管理 dock,替代直接依赖 JLine `Status`)。
- 注册 `terminal.handle(Signal.WINCH, ...)`:resize 时重算尺寸 → 重设滚动区(`ESC[{topH+1};{rows-bottomH}r`)→ 重绘顶栏(按新宽度居中/重排)→ 重绘 dock → 触发 LineReader redisplay。
- **无法在 headless 验证 resize**:需在真实终端人工测,迭代调整。涉及 `InlineRenderer`(~728 行)/`BottomStatusBar`(~445 行)较大改动,建议在分支进行,`main` 保持稳定。
- 边界同上:已滚出的历史无法还原,仅保证活动区干净自适应。

---

## 9. 决策记录

- 动画频率:**每次启动**(2026-06-18,推翻先前"仅首次一次")。
- 动画后字标:**白色**(不再绿色)。
- resize:选 **option 2**(修乱码 + 顶部常驻标识);顶栏内容 1/2/3 行待定。
- 流程:自此 **spec 先行**,先写本规范再实现 B。
