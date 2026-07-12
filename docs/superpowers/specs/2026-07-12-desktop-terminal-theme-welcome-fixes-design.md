# 终端跟随主题(+CLI 适配)+ 首页修正 设计稿

日期:2026-07-12
状态:已与用户确认设计(2 关键点确认),待写实现计划
参考:Codex 浅色/深色下终端两态(用户 image35 浅 / image36 深)。

## 目标

①嵌入式终端跟随 app 主题(浅色 app→浅底终端、深色 app→深底终端),并让 wraith CLI 的字标与用户消息条也随主题(不再有浅底黑框、不再白字隐形);②删除首页固定副标题;③首页示例卡改为「点卡填入输入框+聚焦(不自动发送)」并重措辞为待补全模板。

## 确认的决策(用户)

- 终端**跟随主题 + 改 CLI 适配**(而非固定深色/不改 CLI)。
- 示例卡**点卡填入输入框+聚焦**(不直发)。
- 模板措辞由本方拟(带冒号留空邀请补全)。
- 接受 **CLI 改动需 `mvn package` 重装 jar 后才在嵌入式终端生效**。

---

## Part T — 终端跟随 app 主题 + CLI 适配

跨三层(渲染 + 主进程 + Java CLI)。核心:终端底色跟随主题;桌面把当前主题经环境变量 `WRAITH_TERM_THEME=light|dark` 传给 PTY 里的 CLI;CLI 据此选面板底色 + 字标用默认前景色自适配。

### 渲染层(desktop/src/renderer)
- **`components/TerminalTab.tsx`**:xterm 主题**改回读 CSS 变量**(`--bg-elevated`/`--fg`/`--accent`,即恢复此前被我改成固定深色之前的 cssv 写法)——这样浅色主题下自动浅底、深色下深底。建 PTY 时读当前已解析主题 `document.documentElement.getAttribute('data-theme')`(=`'light'|'dark'`),作为 `ptyCreate({ …, theme })` 传下。终端主题在**创建时**定(切换 app 主题影响新开标签;运行中的 shell/CLI 环境变量不回溯,可接受)。
- **`styles/tokens.css`**:`.xterm .composition-view` **改回 var 基**(`background: var(--bg-elevated); color: var(--fg)` + accent 下划线)——自然跟随主题(撤销此前固定 `#12161c`)。

### 主进程(desktop/src/main + preload)
- **`pty.ts`**:`PtyCreateOpts` 增 `theme?: 'light' | 'dark'`;`create` 里 `env` 增 `WRAITH_TERM_THEME: opts.theme ?? 'dark'`(缺省 dark,保独立行为)。
- **`index.ts`** ipc handler `wraith:ptyCreate`:透传含 `theme` 的 opts(已透传整个 opts,补类型)。
- **`preload/index.ts`**:`ptyCreate` 签名加 `theme?: 'light'|'dark'`。

### Java CLI(src/main/java/com/lyhn/wraith)
- **`util/AnsiStyle.java`**:
  - 新增 `THEME`(静态,读 `System.getenv("WRAITH_TERM_THEME")`,`"light"`→light,否则 dark;仿 `determineEnabled()` 范式)。
  - `BG_PANEL`(用户消息条底色)由固定 `48;5;236` 改为**按 THEME 选**:dark→`48;5;236`(深灰块)、light→`48;5;253`(浅灰块)。`userMessageBlockLine` 里文字在浅块上用可读深字(light 主题给内容加深色前景,如 `38;5;236`;dark 主题维持默认亮字)。前缀 `PURPLE(141)` 在两种块上均可读,保留。
  - `wordmark()`:去掉强制 `[97m`,改用 **BOLD + 默认前景色**(深底→亮、浅底→深,自动适配)。
- **`render/intro/IntroAnimation.java`**:`WHITE = [1;97m` 改为 **BOLD 默认前景**(或按 THEME:light 用深字),使浅色终端下入场动画字标不隐形。
- 缺省(无 `WRAITH_TERM_THEME`)= dark 行为,独立 CLI 与现状一致。

### 生效前提
- 嵌入式终端跑用户机器上的 `wraith`;CLI 改动须 `mvn package` + 装到 `~/.wraith/wraith.jar` 后,终端里新跑的 `wraith` 才见新配色。眼验前需重装 CLI。

---

## Part W — 首页修正(desktop/src/renderer)

### 删副标题
- **`WelcomeEmptyState.tsx`**:删除 `<p>Wraith 会读代码、跑命令、改文件——先说个目标</p>`。保留 logo(闪光/悬停)、标题「今天做点什么?」、示例卡、composer。

### 示例卡:填入 + 聚焦(不发送)+ 重措辞
- **`lib/welcomePrompts.ts`**:`EXAMPLE_PROMPTS` 重措辞为**待补全模板**(带冒号留空邀请补全),约 8 条:
  1. `重构这个函数,让它更清晰:`
  2. `给这段代码补充单元测试:`
  3. `解释这个报错并修复:`
  4. `审查这次改动:`
  5. `为这个模块写说明文档:`
  6. `优化这段代码的性能:`
  7. `排查这个 bug:`
  8. `梳理这个目录的结构:`
  (`pickExamplePrompts` 逻辑与其单测不变——测试按结构断言,不锁定具体文案,仍绿。)
- **`App.tsx`**:
  - `handleSubmit` **撤回 override 参数**,恢复无参 `handleSubmit()`(卡片不再直发,override 无用)。
  - `WelcomeEmptyState` 的 `onPickExample` 改为 **填入 + 聚焦**:`(t) => { setInputValue(t); bumpComposerFocus() }`。
  - 新增聚焦机制:`const [composerFocus, setComposerFocus] = useState(0)`;`bumpComposerFocus = () => setComposerFocus(n => n + 1)`;把 `focusSignal={composerFocus}` 传给 `<Composer>`。
- **`components/Composer.tsx`**:新增可选 prop `focusSignal?: number`;`useEffect(() => { if (focusSignal) textareaRef.current?.focus() }, [focusSignal])`(信号变化即聚焦,首帧 0 不触发)。
- **`WelcomeEmptyState.tsx`** 卡片 `onClick={() => onPickExample(ex)}` 不变(语义由 App 侧从「发送」改「填入」)。

---

## 独立性 / 并行

- **T** 触及:`TerminalTab.tsx`、`tokens.css`、`pty.ts`、`index.ts`、`preload/index.ts`、`AnsiStyle.java`、`IntroAnimation.java`。
- **W** 触及:`WelcomeEmptyState.tsx`、`App.tsx`、`Composer.tsx`、`welcomePrompts.ts`。
- **文件不重叠 → T 与 W 可并行**(W 纯桌面渲染;T 跨渲染/主进程/Java)。T 内部:Java CLI 与桌面部分也相对独立,但同属"终端一态",建议同一实现者串起来保证一致(或桌面/CLI 分两子任务)。

## 测试
- 纯函数:`welcomePrompts` 既有单测保绿(改文案不影响结构断言);无新纯函数。
- typecheck(desktop)exit 0;`npm test` 基线 654 不降;Java 侧 `mvn -q -DskipTests=false test`(相关渲染测试)或至少 `mvn package` 通过。
- 眼验:
  - 浅色 app:终端浅底、WRAITH 字标深色可见、用户消息条浅灰块深字(**无黑框**)、蓝/紫信息行可读;深色 app:终端深底、字标白、消息条深灰块亮字。切主题后**新开**终端标签跟随。
  - 首页:无副标题;点示例卡 → 文案填入输入框且**光标聚焦**、**不自动发送**;可编辑补全后再发。

## 风险
- CLI 需重装 jar 才生效(已知会)。`WRAITH_TERM_THEME` 缺省 dark,独立 CLI 不受影响。
- 浅块 `253` + 深字在极浅终端上对比度;眼验确认可读。
- 终端主题创建时定、不随 app 主题实时切(运行中环境变量不回溯);新标签跟随即可。
- Composer `focusSignal`:首帧 0 不误聚焦;`handleSubmit` 撤 override 后确认 Composer 调用点无参正常、示例卡不再走发送路径。
- `AnsiStyle`/`IntroAnimation` 改动默认(无 env)与现状一致,不破坏独立 CLI 或既有 Java 测试。
