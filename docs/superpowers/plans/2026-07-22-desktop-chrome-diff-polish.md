# 桌面 chrome / diff 打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** chip 首轮 0% + 右侧 diff 填满 + diff 两列切换 + 贯通整窗顶栏(三键锚边)+ 一套克制丝滑动效。

**Architecture:** 纯 renderer(+shared 无)。一处根布局重构(TopBar 提到整窗顶层)。动画纯 CSS transition/keyframe。

**Tech Stack:** React/TS、Tailwind、Monaco DiffEditor、vitest+jsdom、Playwright(shell.e2e)。

## Global Constraints

- 仅改 `desktop/`,不改 Java / 不重打 jar。renderer 改动 dev 下 HMR;但 Task D/E 建议重启+眼验。
- 每任务只 `git add` 该任务文件,**绝不 `git add .`/`-A`**;绝不碰 WIP:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`、`.superpowers/`。
- 提交信息结尾:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01E6qtyEJFHAxiMsCSKsjpQh`。不 push。
- 命令自 `desktop/`:`npx vitest run <file>` / `npx tsc --noEmit` / `npm run build` / `npx playwright test test/e2e/shell.e2e.ts`。
- 动画尊重 `prefers-reduced-motion`(`motion-reduce:` 分支)。
- macOS-only。

---

### Task A: chip 首轮 0%(`StatusChip.tsx` `chipView`)

**Files:** Modify `desktop/src/renderer/components/StatusChip.tsx`;Test `desktop/test/statusChipTier.test.ts`

**Interfaces:** `chipView` 签名不变;新增语义:`status===null && watermark.estimated===true → { pct:0, tw:TIER_TW[0], suffix:'' }`。

- [ ] **Step 1: 加失败测试** — 追加到 `statusChipTier.test.ts` 的 describe 内:
```ts
  it('首轮前:无 status + 估算基线 → 0%(新会话不显基线占用)', () => {
    const v = chipView(null, { ratio: 0.03, tier: 0, estimated: true })
    expect(v.pct).toBe(0)
    expect(v.suffix).toBe('')
  })
```
- [ ] **Step 2: 跑确认失败** — `cd desktop && npx vitest run test/statusChipTier.test.ts` → 该用例 FAIL(现返回 3%~)。
- [ ] **Step 3: 实现** — `StatusChip.tsx` `chipView`,在 `if (watermark) {` 之后、`const pct` 之前插:
```ts
    // 首轮前:仅有估算基线(系统提示词+工具 schema)、尚无真实回合读数 → 显 0%,避免"新会话就 3%"的反直觉。
    if (status === null && watermark.estimated) {
      return { pct: 0, tw: TIER_TW[0], suffix: '' }
    }
```
- [ ] **Step 4: 跑全绿** — `cd desktop && npx vitest run test/statusChipTier.test.ts test/statusChipRender.test.tsx && npx tsc --noEmit`(现有 7 断言 + 新 1;render 测试不回归)。
- [ ] **Step 5: Commit**
```bash
git add desktop/src/renderer/components/StatusChip.tsx desktop/test/statusChipTier.test.ts
git commit -m "feat(desktop): 上下文 chip 首轮前显 0%(无真实用量时不显估算基线)"
```

---

### Task B: 右侧 diff 填满 pane(`DiffView.tsx` + `PreviewPane.tsx`)

**Files:** Modify `desktop/src/renderer/components/DiffView.tsx`、`desktop/src/renderer/components/PreviewPane.tsx`;Test `desktop/test/previewPane.test.tsx`

**Interfaces:** `DiffView` 新增可选 `fill?: boolean`;`fill` 时 host `style.height:'100%'`,跳过 80–400 钳制。PreviewPane diff 分支传 `fill`。

- [ ] **Step 1: 加失败测试** — `previewPane.test.tsx` diff 用例后追加(断言 diff-view host 充满):
```ts
  it('diff 分支:DiffView 以 fill 模式充满(host height 100%)', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'a.ts', before: 'x', after: 'y' }} />)
    const host = screen.getByTestId('diff-view') as HTMLElement
    expect(host.style.height).toBe('100%')
  })
```
（注:jsdom 下 Monaco 动态 import 失败会 setFailed 走 fallback,`diff-view` host 可能不在;若如此,改断言 `diff-preview` 容器存在 + DiffView 收到 fill —— 见 Step 3 备注。实现者按实际渲染取可靠断言,不得弱化为空断言。）
- [ ] **Step 2: 跑确认失败** — `cd desktop && npx vitest run test/previewPane.test.tsx`。
- [ ] **Step 3: 实现 DiffView `fill`** — `DiffView.tsx`:props 加 `fill?: boolean`;底部 return 改为:
```tsx
  if (failed) { /* 原 fallback 不变 */ }
  return <div ref={hostRef} data-testid="diff-view" style={fill ? { height: '100%' } : { height }} />
```
`onDidUpdateDiff` 里 `setHeight(...)` 保留(非 fill 用);fill 时高度由父级决定,setHeight 不影响 style。
- [ ] **Step 4: PreviewPane 传 fill + 去外层 overflow** — `PreviewPane.tsx` diff 分支的 `<div className="min-h-0 flex-1 overflow-auto"><DiffView .../></div>` 改为:
```tsx
        <div className="min-h-0 flex-1">
          <DiffView fill filePath={preview.filePath} before={preview.before} after={preview.after} />
        </div>
```
- [ ] **Step 5: 跑全绿 + 类型** — `cd desktop && npx vitest run test/previewPane.test.tsx && npx tsc --noEmit`。
- [ ] **Step 6: Commit**
```bash
git add desktop/src/renderer/components/DiffView.tsx desktop/src/renderer/components/PreviewPane.tsx desktop/test/previewPane.test.tsx
git commit -m "feat(desktop): 右侧 diff 填满 pane(DiffView fill 模式,去 400px 钳制)"
```

---

### Task C: diff 两列切换(`DiffView.tsx` + `PreviewPane.tsx`)

**Files:** Modify `desktop/src/renderer/components/DiffView.tsx`、`desktop/src/renderer/components/PreviewPane.tsx`;Test `desktop/test/previewPane.test.tsx`

**Interfaces:** `DiffView` 新增 `sideBySide?: boolean` → Monaco `renderSideBySide`;PreviewPane diff 头部加 `diff-split-toggle` 按钮(本地 state)。

- [ ] **Step 1: 加失败测试** — `previewPane.test.tsx` 追加:
```ts
  it('diff 分支:有分两列切换按钮,点击翻转 aria-pressed', () => {
    render(<PreviewPane preview={{ kind: 'diff', filePath: 'a.ts', before: 'x', after: 'y' }} />)
    const btn = screen.getByTestId('diff-split-toggle')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
```
（顶部 import 补 `fireEvent`。）
- [ ] **Step 2: 跑确认失败** — `cd desktop && npx vitest run test/previewPane.test.tsx`。
- [ ] **Step 3: DiffView `sideBySide`** — `DiffView.tsx`:props 加 `sideBySide?: boolean`;`createDiffEditor` 的 `renderSideBySide: false` 改为 `renderSideBySide: !!sideBySide`;并把 `sideBySide` 加入该 `useEffect` 依赖数组(`[filePath, before, after, sideBySide]`),切换时重建编辑器。
- [ ] **Step 4: 抽 DiffPreview 子组件 + 切换按钮** — `PreviewPane.tsx`:顶部 import `useState` from 'react'、`Columns2` from 'lucide-react'。把 diff 分支抽成同文件内的小组件 `DiffPreview`(持自己的 `split` state),PreviewPane diff 分支渲染 `<DiffPreview key={preview.filePath} preview={preview} />`(`key` 让切换文件时重挂、split 复位为 inline):
```tsx
function DiffPreview({ preview }: { preview: { filePath: string; before: string; after: string } }): JSX.Element {
  const [split, setSplit] = useState(false)
  return (
    <div data-testid="diff-preview" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
        <span className="truncate font-mono font-semibold" title={preview.filePath}>{baseName(preview.filePath)}</span>
        <span className="shrink-0 text-2xs font-normal text-fg-subtle">· 更改</span>
        <button data-testid="diff-split-toggle" aria-pressed={split} onClick={() => setSplit(v => !v)}
          title={split ? '切回行内 diff' : '分两列显示(类 git)'}
          className={'ml-auto rounded p-1 ' + (split ? 'text-accent' : 'text-fg-subtle hover:text-fg')}>
          <Columns2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DiffView fill sideBySide={split} filePath={preview.filePath} before={preview.before} after={preview.after} />
      </div>
    </div>
  )
}
```
PreviewPane 的 diff 分支(原先内联那段)整体替换为:`return <DiffPreview key={preview.filePath} preview={preview} />`。
> 注:此步同时吸收 Task B 的 diff 分支布局(`min-h-0 flex-1` + `<DiffView fill .../>`)——若 Task B 已落地,这里把它并入 DiffPreview 即可,保持 `fill`。
- [ ] **Step 5: 跑全绿 + 类型** — `cd desktop && npx vitest run test/previewPane.test.tsx && npx tsc --noEmit`。
- [ ] **Step 6: Commit**
```bash
git add desktop/src/renderer/components/DiffView.tsx desktop/src/renderer/components/PreviewPane.tsx desktop/test/previewPane.test.tsx
git commit -m "feat(desktop): diff 分两列(类 git)切换按钮"
```

---

### Task E: 克制丝滑动效(`tokens.css` + `RightDock`/`TerminalDrawer`/`SidebarDock`/`PreviewPane`)

**Files:** Modify `desktop/src/renderer/styles/tokens.css`、`RightDock.tsx`、`TerminalDrawer.tsx`、`SidebarDock.tsx`、`PreviewPane.tsx`

**Interfaces:** 新增 CSS:`--ease-smooth` 变量 + `@keyframes panelContentIn` + `.animate-panel-in` 工具类(含 reduced-motion 兜底)。

- [ ] **Step 1: tokens.css 加令牌 + keyframe** — 追加到 `tokens.css` 末尾:
```css
:root { --ease-smooth: cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes panelContentIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-panel-in { animation: panelContentIn 200ms var(--ease-smooth) both; }
@media (prefers-reduced-motion: reduce) {
  .animate-panel-in { animation: none; }
}
```
- [ ] **Step 2: RightDock 壳过渡收紧** — `RightDock.tsx`:壳 className 里 `transition-[width] duration-300 ease-out` → `transition-[width] duration-[220ms] [transition-timing-function:var(--ease-smooth)]`。
- [ ] **Step 3: TerminalDrawer 壳过渡收紧** — `TerminalDrawer.tsx`:`transition-[height] duration-300 ease-out` → `transition-[height] duration-[220ms] [transition-timing-function:var(--ease-smooth)]`。
- [ ] **Step 4: SidebarDock 占位过渡对齐** — `SidebarDock.tsx`:`transition-[width] duration-200 ease-out` → `transition-[width] duration-[220ms] [transition-timing-function:var(--ease-smooth)]`。
- [ ] **Step 5: 内容进入动画** — `PreviewPane.tsx`:content 分支与 diff 分支最外层容器加 `animate-panel-in`(null 占位不加)。TerminalDrawer 的 `<TerminalPane>` 外包一层 `animate-panel-in`(仅 open 时;可给 TerminalPane 容器加类)。
> 仅调 easing/时长 + 内容进入;不动开合触发逻辑与拖拽调宽/高。
- [ ] **Step 6: 构建 + 类型 + 眼验说明** — `cd desktop && npx tsc --noEmit && npm run build`(动画无单测;真机眼验流畅度)。全量 `npx vitest run` 不回归。
- [ ] **Step 7: Commit**
```bash
git add desktop/src/renderer/styles/tokens.css desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/components/TerminalDrawer.tsx desktop/src/renderer/components/SidebarDock.tsx desktop/src/renderer/components/PreviewPane.tsx
git commit -m "feat(desktop): 统一克制丝滑动效(220ms/ease-smooth + 面板内容淡入上滑)"
```

---

### Task D: 贯通整窗顶栏(**高风险,最后做,含 shell.e2e 全回归**)

**Files:** Create `desktop/src/renderer/components/TopBar.tsx`;Modify `desktop/src/renderer/App.tsx`、`desktop/src/renderer/components/Sidebar.tsx`

**Interfaces:**
- `TopBar` props:`{ platform: string; sidebarCollapsed: boolean; onToggleSidebar: () => void; showChat: boolean; terminalOpen: boolean; onToggleTerminal: () => void; rightDockOpen: boolean; onToggleRightDock: () => void }`。
- testid:`sidebar-toggle`(左)、`terminal-toggle`、`rightdock-toggle`(右,沿用原名)。
- 已核:**e2e 未引用这些 testid**(`rg` 零命中),故 testid 迁移无 e2e 断言破坏;但顶栏重构改变整体高度分配,仍须完整 shell.e2e 回归(尤其 transcript 溢出/贴底/审批相关)。

- [ ] **Step 1: 建 TopBar 组件** — `desktop/src/renderer/components/TopBar.tsx`:
```tsx
import { PanelLeft, PanelRight, SquareTerminal } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

/** 贯通整窗顶栏:左簇=交通灯内衬 + 侧栏切换(恒显);右簇=终端 + 右栏(恒显);中段 drag。 */
export default function TopBar({ platform, sidebarCollapsed, onToggleSidebar, showChat, terminalOpen, onToggleTerminal, rightDockOpen, onToggleRightDock }: {
  platform: string
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  showChat: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  rightDockOpen: boolean
  onToggleRightDock: () => void
}): JSX.Element {
  const btn = (active: boolean): string =>
    'flex items-center rounded-lg p-1.5 text-xs transition duration-150 active:scale-90 motion-reduce:transform-none hover:bg-fg/5 hover:text-fg [-webkit-app-region:no-drag] ' + (active ? 'text-accent' : 'text-fg-muted')
  return (
    <div data-testid="topbar" className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(platform)}>
      <button data-testid="sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} className={btn(false)}>
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1" />
      {showChat && (
        <div className="flex items-center gap-1 pr-2">
          <button data-testid="terminal-toggle" onClick={onToggleTerminal} title="终端" className={btn(terminalOpen)}>
            <SquareTerminal className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button data-testid="rightdock-toggle" onClick={onToggleRightDock} title="右侧面板(浏览器/终端)" className={btn(rightDockOpen)}>
            <PanelRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  )
}
```
> 决策记录:右簇维持 `showChat` 才显(与现状一致,非 chat 视图无终端/右栏语义);侧栏切换键全视图恒显。若用户要"全视图都显右簇",去掉 `showChat &&` 即可——本任务按 spec「恒显+锚边」实现,右簇仍限 chat(spec ④ 未要求把终端/右栏带到设置等视图)。**实现者若认为该与 spec 冲突,按 SDD 流程上报,不自行改。**
- [ ] **Step 2: App 根改竖分两层 + 挂 TopBar** — `App.tsx`:
  - 最外层 `<div className="flex h-screen overflow-hidden text-fg">` → `<div className="flex h-screen flex-col overflow-hidden text-fg">`。
  - 在其内、`<div className="flex min-h-0 flex-1 overflow-hidden">`(body 行)**之前**插入:
```tsx
      <TopBar
        platform={window.wraith.platform}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(v => !v)}
        showChat={view === 'chat'}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(v => !v)}
        rightDockOpen={rightDockOpen}
        onToggleRightDock={() => setRightDockOpen(v => !v)}
      />
```
  - import TopBar。
- [ ] **Step 3: 删内容列原顶行** — `App.tsx`:删除内容列里那段 `<div className={'flex h-[38px] ... '}>...(sidebar-expand + terminal/rightdock 按钮)...</div>`(约 947–974 行整块),因其功能已迁入 TopBar。内容列首元素变为其后的 banner/transcript。
- [ ] **Step 4: 删侧栏原顶行** — `Sidebar.tsx`:删除顶段 `<div className={'flex h-[38px] ... topBarLeftPad ...'}>` 里的 `sidebar-collapse` 那整块顶行(约 199–213 行),侧栏首元素变为其后的 brand-home(Logo)行。移除 `topBarLeftPad` import(若不再用)与 `PanelLeft` import(若不再用)。
- [ ] **Step 5: 类型 + 全量单测 + 构建** — `cd desktop && npx tsc --noEmit && npx vitest run && npm run build`。tsc 净、单测全绿。
- [ ] **Step 6: shell.e2e 全回归**(硬门) — `cd desktop && npx playwright test test/e2e/shell.e2e.ts --reporter=line`。预期 46–47 pass + 1 skip;**唯一容忍的失败是既有满载 flake T34**(基线亦挂、隔离能过)。若 Test 21(贴底)或其它因顶栏改高度分配而挂,必须修到隔离确定性通过再继续。
- [ ] **Step 7: Commit**
```bash
git add desktop/src/renderer/components/TopBar.tsx desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(desktop): 贯通整窗顶栏 — 侧栏/终端/右栏三键恒显锚窗口两端,不随开合飘移"
```

---

## 收尾(SDD 全部任务后)

- [ ] 终审:整分支代码审查(opus)。重点:Task D 布局重构无残留旧顶行/双 toggle、交通灯内衬只在 TopBar、shell.e2e 全回归结论;动画尊重 reduced-motion;chip 0% 口径不误伤 Plan/Team。
- [ ] 交付说明:Task D/E 建议**完全重启 dev App** 眼验(布局/动画);验:三键恒显锚边不飘、右栏 diff 填满 + 两列切换、新会话 chip 0%、各面板开合丝滑。
