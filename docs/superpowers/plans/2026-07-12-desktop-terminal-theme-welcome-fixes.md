# 终端跟随主题(+CLI 适配)+ 首页修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 嵌入式终端跟随 app 主题(浅底/深底),wraith CLI 字标与用户消息条随主题适配(经 `WRAITH_TERM_THEME` 环境变量);首页删副标题、示例卡改「点卡填入+聚焦」并重措辞为待补全模板。

**Architecture:** 三个文件不重叠、可并行的任务:T-a 桌面终端主题(渲染 + 主进程 + preload);T-b Java CLI 配色适配(AnsiStyle + IntroAnimation);W 首页(WelcomeEmptyState + welcomePrompts + App + Composer)。T-a 与 T-b 靠环境变量 `WRAITH_TERM_THEME`(值 `light`|`dark`)对接。

**Tech Stack:** Electron + electron-vite(渲染 React/TS + 主进程 TS)+ Java 17 / Maven;Tailwind;vitest。

## Global Constraints
- 桌面命令在 `desktop/` 下;`npm run typecheck` exit 0;`npm test` 基线 **654** 不降。
- Java 命令在仓库根;`mvn -q -DskipTests package` 须通过(构建 jar)。
- 纯前端不碰 config/密钥/日志;不改主进程既有安全面。
- 环境变量契约:名严格 `WRAITH_TERM_THEME`,值 `light` 或 `dark`;CLI 缺省(未设)= dark,不改独立 CLI 行为。
- CLI 改动需 `mvn package` + 装 `~/.wraith/wraith.jar` 后才在嵌入式终端生效(眼验前提)。
- push 需用户单独点头。

---

### Task T-a: 桌面终端跟随主题 + 传 WRAITH_TERM_THEME

**Files:**
- Modify: `desktop/src/renderer/components/TerminalTab.tsx`(xterm 主题改回读 CSS 变量)
- Modify: `desktop/src/renderer/components/TerminalPane.tsx`(建 PTY 时传 theme)
- Modify: `desktop/src/renderer/styles/tokens.css`(composition-view 改回 var 基)
- Modify: `desktop/src/main/pty.ts`(PtyCreateOpts + env)
- Modify: `desktop/src/main/index.ts`(ipc handler 类型透传)
- Modify: `desktop/src/preload/index.ts`(ptyCreate 签名)

**Interfaces (Produces):** PTY 子进程环境变量 `WRAITH_TERM_THEME=light|dark`(T-b 消费)。

- [ ] **Step 1: TerminalTab.tsx —— xterm 主题改回读 CSS 变量(跟随主题)**

把当前固定深色的 theme 块替换为读 CSS 变量:
原(现状,固定深色):
```tsx
    const term = new Terminal({
      fontSize: 13, fontFamily: 'Menlo, Monaco, monospace', cursorBlink: true,
      // 终端固定深色:CLI/TUI(如 wraith)按深色终端设计;浅色终端会把其深底样式显成黑框、看不清。
      theme: {
        background: '#12161c',
        foreground: '#e6edf3',
        cursor: '#0ea5b7',
        cursorAccent: '#12161c',
        selectionBackground: 'rgba(14,165,183,0.30)',
      },
    })
```
改为:
```tsx
    // 主题感知:从 CSS 变量取色,浅/深随 app [data-theme] 自动匹配(CLI 侧配色经 WRAITH_TERM_THEME 同步)
    const cs = getComputedStyle(document.documentElement)
    const cssv = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb
    const term = new Terminal({
      fontSize: 13, fontFamily: 'Menlo, Monaco, monospace', cursorBlink: true,
      theme: {
        background: cssv('--bg-elevated', '#ffffff'),
        foreground: cssv('--fg', '#1c2430'),
        cursor: cssv('--accent', '#0ea5b7'),
        cursorAccent: cssv('--bg-elevated', '#ffffff'),
        selectionBackground: 'rgba(14,165,183,0.22)',
      },
    })
```

- [ ] **Step 2: TerminalPane.tsx —— 建 PTY 时读当前主题并传下**

`addNew` 里当前是 `const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined })`。改为:
```tsx
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
      const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined, theme })
```

- [ ] **Step 3: tokens.css —— composition-view 改回 var 基(跟随主题)**

把当前 `.xterm .composition-view` 块的固定深色改回 CSS 变量:
原:
```css
.xterm .composition-view {
  background: #12161c !important;
  color: #e6edf3 !important;
  border-bottom: 1px solid var(--accent);
  padding: 0 1px;
}
```
改为:
```css
.xterm .composition-view {
  background: var(--bg-elevated) !important;
  color: var(--fg) !important;
  border-bottom: 1px solid var(--accent);
  padding: 0 1px;
}
```
(注释同步为"随主题的淡色输入";`!important` 保留——xterm.css 组件导入同优先级会覆盖。)

- [ ] **Step 4: pty.ts —— PtyCreateOpts + WRAITH_TERM_THEME env**

`PtyCreateOpts` 加 `theme`:
```ts
export interface PtyCreateOpts { cwd?: string; cols?: number; rows?: number; theme?: 'light' | 'dark' }
```
`create()` 里的 env 行(现为 `{ ...this.env, SHELL_SESSIONS_DISABLE: '1' }`)改为:
```ts
    const env = { ...this.env, SHELL_SESSIONS_DISABLE: '1', WRAITH_TERM_THEME: opts.theme ?? 'dark' } as { [key: string]: string }
```

- [ ] **Step 5: index.ts + preload/index.ts —— 透传 theme 类型**

`index.ts` 的 handler(现 `(_e, opts?: { cwd?: string; cols?: number; rows?: number }) => …`)类型加 `theme`:
```ts
ipcMain.handle('wraith:ptyCreate', (_e, opts?: { cwd?: string; cols?: number; rows?: number; theme?: 'light' | 'dark' }) => ptyManager?.create(opts ?? {}) ?? { id: '' })
```
`preload/index.ts` 的 `ptyCreate` 签名(接口声明处)同样加 `theme?: 'light' | 'dark'`(两处:类型声明 L138 附近 + 实现 L568 的 opts 直接透传,无需改实现体)。

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `npm run typecheck`(exit 0);`npm test`(不低于 654,无新增失败)。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/TerminalTab.tsx desktop/src/renderer/components/TerminalPane.tsx desktop/src/renderer/styles/tokens.css desktop/src/main/pty.ts desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop/term): 嵌入式终端跟随 app 主题 + 传 WRAITH_TERM_THEME 给 CLI"
```

**眼验(需配合 T-b 的 CLI 重装):** 浅色 app → 终端浅底;深色 app → 深底;切主题后新开终端标签跟随。

---

### Task T-b: Java CLI 按 WRAITH_TERM_THEME 适配配色

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/util/AnsiStyle.java`
- Modify: `src/main/java/com/lyhn/wraith/render/intro/IntroAnimation.java`

**Interfaces (Consumes):** 环境变量 `WRAITH_TERM_THEME=light|dark`(T-a 提供;未设=dark)。

- [ ] **Step 1: AnsiStyle.java —— THEME 标志 + BG_PANEL 按主题 + wordmark 去强制白**

在字段区(`private static final boolean ENABLED = determineEnabled();` 附近)加:
```java
    private static final boolean LIGHT_TERM = "light".equalsIgnoreCase(System.getenv("WRAITH_TERM_THEME"));
```
把 `BG_PANEL` 常量:
```java
    private static final String BG_PANEL = "[48;5;236m";
```
改为(浅主题用浅灰块,深主题维持深灰块):
```java
    private static final String BG_PANEL = LIGHT_TERM ? "[48;5;253m" : "[48;5;236m";
```
`wordmark()` 方法:
```java
    public static String wordmark(String text) {
        return wrap(BOLD + (char) 27 + "[97m", text);
    }
```
改为(去掉强制亮白,用终端默认前景 → 深底白/浅底黑自动适配):
```java
    public static String wordmark(String text) {
        return wrap(BOLD, text);
    }
```
（`userMessageBlockLine` 不改:内容 `safe` 无显式前景 → 用终端默认前景,浅终端=深字、深终端=亮字,配合 BG_PANEL 各自可读;前缀 `PURPLE(141)` 两种块上均可读。）

- [ ] **Step 2: IntroAnimation.java —— 字标动画去强制白**

`private static final String WHITE = ESC + "[1;97m";`(L26)改为:
```java
    private static final String WHITE = ESC + "[1m";
```
(用途 L152 `out.print(WHITE + row + RESET)` 不变;bold 默认前景 → 浅终端下入场字标不隐形。)

- [ ] **Step 3: 编译 + 打包通过**

Run(仓库根):`mvn -q -DskipTests package`
Expected: BUILD SUCCESS(产出 jar)。（纯配色字符串改动,无逻辑;测试沿用默认跳过,不引入新失败。）

- [ ] **Step 4: 提交**

```bash
git add src/main/java/com/lyhn/wraith/util/AnsiStyle.java src/main/java/com/lyhn/wraith/render/intro/IntroAnimation.java
git commit -m "feat(cli/render): 终端配色按 WRAITH_TERM_THEME 适配(字标默认前景 + 用户消息条浅/深块)"
```

**眼验(装 jar 后):** 深色终端:字标白、用户消息条深灰块亮字;浅色终端:字标深、用户消息条浅灰块深字(无黑框)。缺省(无 env)与现状一致。

---

### Task W: 首页删副标题 + 示例卡填入聚焦 + 待补全模板

**Files:**
- Modify: `desktop/src/renderer/components/WelcomeEmptyState.tsx`
- Modify: `desktop/src/renderer/lib/welcomePrompts.ts`
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Composer.tsx`

**Interfaces:** App 用 `focusSignal: number` prop 驱动 Composer 聚焦;`onPickExample(text)` 语义 = 填入 + 聚焦。

- [ ] **Step 1: WelcomeEmptyState.tsx —— 删副标题**

删除这一行(标题 `<h1>今天做点什么?</h1>` 之后的副标题):
```tsx
      <p className="mb-6 text-sm text-fg-muted">Wraith 会读代码、跑命令、改文件——先说个目标</p>
```
（其余保留:logo、标题、示例卡网格、`{children}`。可把标题的 `mb-2` 视觉留白按需微调,非必需。）

- [ ] **Step 2: welcomePrompts.ts —— 重措辞为 8 条待补全模板**

把 `EXAMPLE_PROMPTS` 数组内容替换为:
```ts
export const EXAMPLE_PROMPTS: string[] = [
  '重构这个函数,让它更清晰:',
  '给这段代码补充单元测试:',
  '解释这个报错并修复:',
  '审查这次改动:',
  '为这个模块写说明文档:',
  '优化这段代码的性能:',
  '排查这个 bug:',
  '梳理这个目录的结构:',
]
```
（`pickExamplePrompts` 逻辑与 `test/welcomePrompts.test.ts` 不变——测试按结构断言、不锁具体文案,保持绿。）

- [ ] **Step 3: Composer.tsx —— 加 focusSignal prop + 聚焦 effect**

`ComposerProps` 接口加一行(与其它可选 prop 并列):
```ts
  focusSignal?: number
```
在解构参数里加 `focusSignal`(与其它 props 并列)。在组件内(与其它 `useEffect` 并列)加:
```tsx
  // 首页示例卡「填入并聚焦」:信号变化即聚焦输入框(首帧 0 不触发)
  useEffect(() => { if (focusSignal) textareaRef.current?.focus() }, [focusSignal])
```

- [ ] **Step 4: App.tsx —— handleSubmit 撤 override + composerFocus + onPickExample 填入聚焦 + 传 focusSignal**

(a) `handleSubmit` 撤回 override,恢复无参:
```tsx
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    // …(其余 body 与现状一致,不动)
  }, [inputValue, state.turn, state.model, attachments, pendingMode])
```
(b) 状态区(`const [examplePrompts] = …` 附近)加:
```tsx
  const [composerFocus, setComposerFocus] = useState(0)
```
(c) `WelcomeEmptyState` 的 `onPickExample` 改为填入 + 聚焦:
```tsx
                    <WelcomeEmptyState examples={examplePrompts} onPickExample={(t) => { setInputValue(t); setComposerFocus(n => n + 1) }}>{composer}</WelcomeEmptyState>
```
(d) `<Composer …>` 加 prop:`focusSignal={composerFocus}`。

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `npm run typecheck`(exit 0);`npm test`(不低于 654,`welcomePrompts` 测试仍绿)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/WelcomeEmptyState.tsx desktop/src/renderer/lib/welcomePrompts.ts desktop/src/renderer/App.tsx desktop/src/renderer/components/Composer.tsx
git commit -m "feat(desktop/welcome): 删副标题 + 示例卡改点填入聚焦(不直发)+ 待补全模板"
```

**眼验:** 首页无副标题;点示例卡 → 模板填入输入框、光标聚焦、不自动发送;可补全后再发。

---

## 执行顺序 / 并行
- **T-a、T-b、W 文件完全不重叠 → 三者可并行**(T-a 桌面渲染+主进程;T-b Java;W 桌面渲染)。
- 唯一跨任务契约:环境变量 `WRAITH_TERM_THEME`(名/值),T-a 与 T-b 均已写死一致。
- 眼验 T 需 T-b 的 jar 重装 + T-a 的 dev 重启。

## Self-Review
**Spec coverage:** 终端跟随主题(TerminalTab/TerminalPane/tokens/pty/index/preload)→T-a;CLI 适配(AnsiStyle BG_PANEL+wordmark、IntroAnimation)→T-b;删副标题+卡填入聚焦+模板→W。✓
**Placeholder scan:** 每处给了原→改的确切代码;无 TBD。✓
**Type consistency:** `theme?:'light'|'dark'` 在 PtyCreateOpts/handler/preload/TerminalPane 一致;`WRAITH_TERM_THEME` 值 `light|dark` 两任务一致;`focusSignal:number` 在 Composer prop 与 App 传参一致;`handleSubmit` 撤 override 后 Composer 无参调用不变。✓
