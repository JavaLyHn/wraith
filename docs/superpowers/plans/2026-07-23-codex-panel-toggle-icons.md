# Codex 式面板切换键 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把顶栏三个切换键(侧栏/终端/右栏)换成 Codex 式自绘窗口 glyph——分隔线滑动 + 对应格填实、hover 显柔底/开态常驻、单色墨。

**Architecture:** 新建纯展示组件 `PanelToggleIcon`(SVG,`side` × `open` 两参,窗口轮廓静态 + 分隔线 translate + 填充块 scale,CSS transform transition 动画),再接进 `TopBar` 替换三处 lucide 图标并加 squircle 柔底样式。纯 renderer,不改 Java / 不重打 jar / 不动顶栏布局结构与 testid。

**Tech Stack:** React 18 + TypeScript,Tailwind(含项目自定义 token `--ease-smooth`),Vitest + @testing-library/react(jsdom),Playwright(shell.e2e)。

## Global Constraints

- 不改 Java / 不重打 jar;仅动 `desktop/` renderer。
- 保留全部现有 testid(`sidebar-toggle` / `terminal-toggle` / `rightdock-toggle`)与 onClick 回调契约,顶栏布局结构(`[-webkit-app-region:drag]`、`topBarLeftPad`、`showChat` 门控右簇、中段 `flex-1`)不变。
- 动画忠实决策:**线滑动 + 填充**;悬浮底 **hover 显 + 开态常驻、无投影**;配色 **单色墨(`fg`/`fg-muted`,不上 accent)**。
- 动效复用现有令牌 `--ease-smooth`(`tokens.css` 已定义),时长 200ms;`prefers-reduced-motion` 关过渡、落终态。
- 测试断言用语义属性 `data-open`/`data-side`,**不**断言脆弱的 transform 字符串(jsdom 不算 transform)。
- 所有命令在 `desktop/` 目录下运行。`git add` 仅限本任务文件,禁止 `git add .`/`-A`。

---

### Task 1: PanelToggleIcon 自绘 glyph 组件

**Files:**
- Create: `desktop/src/renderer/components/PanelToggleIcon.tsx`
- Test: `desktop/test/panelToggleIcon.test.tsx`

**Interfaces:**
- Consumes: 无(纯叶子组件;仅依赖 CSS 变量 `--ease-smooth`,已在 `desktop/src/renderer/styles/tokens.css` 定义)。
- Produces:
  ```ts
  export type PanelSide = 'left' | 'right' | 'bottom'
  export default function PanelToggleIcon(props: {
    side: PanelSide
    open: boolean
    className?: string   // 默认 'h-4 w-4',透传到 <svg>
  }): JSX.Element
  ```
  渲染出:一个无 testid 的窗口轮廓 `<rect>`;一个 `data-testid="panel-fill"` 的填充 `<rect>`;一个 `data-testid="panel-divider"` 的分隔线 `<rect>`。后两者带 `data-open`(`'true'`/`'false'` 字符串)与 `data-side`(`'left'`/`'right'`/`'bottom'`)。

**几何说明(viewBox 24):** 窗口轮廓 `rect(3,3,18,18,rx3)`。分隔线开态中心:left=9.5、right=14.5、bottom=14.5(下 1/3);关态中心停外边框:left=4.5、right=19.5、bottom=19.5。填充块外缘严格对齐分隔线开态中心。

- [ ] **Step 1: 写失败测试**

写入 `desktop/test/panelToggleIcon.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PanelToggleIcon from '../src/renderer/components/PanelToggleIcon'

afterEach(() => cleanup())

describe('PanelToggleIcon', () => {
  it('open=true → fill/divider 的 data-open=true', () => {
    render(<PanelToggleIcon side="left" open={true} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-open')).toBe('true')
    expect(screen.getByTestId('panel-divider').getAttribute('data-open')).toBe('true')
  })

  it('open=false → fill/divider 的 data-open=false', () => {
    render(<PanelToggleIcon side="left" open={false} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-open')).toBe('false')
    expect(screen.getByTestId('panel-divider').getAttribute('data-open')).toBe('false')
  })

  it.each(['left', 'right', 'bottom'] as const)('side=%s → data-side 对应且窗口轮廓 rect 存在', (side) => {
    const { container } = render(<PanelToggleIcon side={side} open={false} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-side')).toBe(side)
    expect(screen.getByTestId('panel-divider').getAttribute('data-side')).toBe(side)
    // 窗口轮廓 = svg 下唯一无 data-testid 的 rect
    expect(container.querySelector('svg > rect:not([data-testid])')).toBeTruthy()
  })

  it('className 透传到 svg', () => {
    const { container } = render(<PanelToggleIcon side="right" open className="h-5 w-5" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-5 w-5')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/panelToggleIcon.test.tsx`
Expected: FAIL —— 模块 `../src/renderer/components/PanelToggleIcon` 不存在(Cannot find module / 解析失败)。

- [ ] **Step 3: 写实现**

写入 `desktop/src/renderer/components/PanelToggleIcon.tsx`:

```tsx
import type { CSSProperties } from 'react'

export type PanelSide = 'left' | 'right' | 'bottom'

/**
 * Codex 式面板切换 glyph:静态窗口轮廓 + 会 translate 的分隔线 + 会 scale 的填充块。
 * open 变化时:分隔线从外边框滑到格内侧、对应格同步填实(线丝滑滑动 + 填充)。单色墨(currentColor)。
 * 填充块外缘严格对齐分隔线开态中心,避免视觉错位。
 */
type Geo = {
  fill: { x: number; y: number; width: number; height: number }
  fillOrigin: string
  fillOpen: string
  fillClosed: string
  divider: { x: number; y: number; width: number; height: number }
  dividerOpen: string
}

const GEO: Record<PanelSide, Geo> = {
  left: {
    fill: { x: 3.5, y: 5, width: 6, height: 14 }, // 右缘 9.5 = 分隔线开态中心
    fillOrigin: 'left center', fillOpen: 'scaleX(1)', fillClosed: 'scaleX(0)',
    divider: { x: 3.75, y: 5, width: 1.5, height: 14 }, // 关态中心 4.5
    dividerOpen: 'translateX(5px)', // → 中心 9.5
  },
  right: {
    fill: { x: 14.5, y: 5, width: 6, height: 14 }, // 左缘 14.5 = 分隔线开态中心
    fillOrigin: 'right center', fillOpen: 'scaleX(1)', fillClosed: 'scaleX(0)',
    divider: { x: 18.75, y: 5, width: 1.5, height: 14 }, // 关态中心 19.5
    dividerOpen: 'translateX(-5px)', // → 中心 14.5
  },
  bottom: {
    fill: { x: 5, y: 14.5, width: 14, height: 6 }, // 上缘 14.5 = 分隔线开态中心
    fillOrigin: 'center bottom', fillOpen: 'scaleY(1)', fillClosed: 'scaleY(0)',
    divider: { x: 5, y: 18.75, width: 14, height: 1.5 }, // 关态中心 19.5
    dividerOpen: 'translateY(-5px)', // → 中心 14.5
  },
}

// 复用 tokens.css 的 --ease-smooth;reduced-motion 关过渡(终态仍由内联 transform 立即生效)。
const ANIM = 'transition-transform duration-200 [transition-timing-function:var(--ease-smooth)] motion-reduce:transition-none'

export default function PanelToggleIcon({ side, open, className = 'h-4 w-4' }: {
  side: PanelSide
  open: boolean
  className?: string
}): JSX.Element {
  const g = GEO[side]
  const fillStyle: CSSProperties = {
    transformBox: 'fill-box',
    transformOrigin: g.fillOrigin,
    transform: open ? g.fillOpen : g.fillClosed,
  }
  const dividerStyle: CSSProperties = {
    transformBox: 'fill-box',
    transform: open ? g.dividerOpen : 'translate(0)',
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={3} />
      <rect data-testid="panel-fill" data-open={String(open)} data-side={side}
        x={g.fill.x} y={g.fill.y} width={g.fill.width} height={g.fill.height}
        fill="currentColor" stroke="none" className={ANIM} style={fillStyle} />
      <rect data-testid="panel-divider" data-open={String(open)} data-side={side}
        x={g.divider.x} y={g.divider.y} width={g.divider.width} height={g.divider.height}
        fill="currentColor" stroke="none" className={ANIM} style={dividerStyle} />
    </svg>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/panelToggleIcon.test.tsx`
Expected: PASS(6 个用例:2 open 态 + 3 side + 1 className)。

- [ ] **Step 5: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 无输出、退出码 0(注意 `CSSProperties.transformBox`/`transformOrigin` 均为合法 React 内联样式键)。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/components/PanelToggleIcon.tsx desktop/test/panelToggleIcon.test.tsx
git commit -m "feat(desktop): PanelToggleIcon 自绘面板切换 glyph(滑线+填充/单色墨)"
```

---

### Task 2: 接进 TopBar(glyph 替换 + squircle 柔底 + open 接线)

**Files:**
- Modify: `desktop/src/renderer/components/TopBar.tsx`(整文件重写图标与 `btn()`)
- Test: `desktop/test/topBarComponent.test.tsx`(在现有基础上追加用例)

**Interfaces:**
- Consumes: Task 1 的 `PanelToggleIcon`(`{ side: 'left'|'right'|'bottom'; open: boolean; className? }`,渲染带 `data-testid="panel-fill"`/`"panel-divider"` + `data-open`/`data-side` 的子元素)。
- Produces: 无对外新接口(TopBar props 契约不变)。

- [ ] **Step 1: 写失败测试(追加用例)**

在 `desktop/test/topBarComponent.test.tsx` 中:第 3 行的 import 改为同时引入 `within`:

```tsx
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
```

并在 `describe('TopBar', () => {` 块内、末尾 `})` 之前追加:

```tsx
  it('侧栏 glyph 反映折叠态:展开=open、折叠=关', () => {
    const { rerender } = render(<TopBar {...base} sidebarCollapsed={false} />)
    const fill = () => within(screen.getByTestId('sidebar-toggle')).getByTestId('panel-fill')
    expect(fill().getAttribute('data-open')).toBe('true')
    expect(fill().getAttribute('data-side')).toBe('left')
    rerender(<TopBar {...base} sidebarCollapsed={true} />)
    expect(fill().getAttribute('data-open')).toBe('false')
  })

  it('终端/右栏 glyph 随各自 open prop 翻转,side 正确', () => {
    render(<TopBar {...base} terminalOpen rightDockOpen={false} />)
    const term = within(screen.getByTestId('terminal-toggle')).getByTestId('panel-fill')
    const dock = within(screen.getByTestId('rightdock-toggle')).getByTestId('panel-fill')
    expect(term.getAttribute('data-open')).toBe('true')
    expect(term.getAttribute('data-side')).toBe('bottom')
    expect(dock.getAttribute('data-open')).toBe('false')
    expect(dock.getAttribute('data-side')).toBe('right')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/topBarComponent.test.tsx`
Expected: FAIL —— 新用例找不到 `panel-fill`(TopBar 仍渲染 lucide 图标,尚无 glyph)。现有 3 个用例仍通过。

- [ ] **Step 3: 写实现(整文件重写 TopBar)**

把 `desktop/src/renderer/components/TopBar.tsx` 整个替换为:

```tsx
import PanelToggleIcon from './PanelToggleIcon'
import { topBarLeftPad } from '../lib/topBar'

/** 贯通整窗顶栏:左簇=交通灯内衬 + 侧栏切换(恒显);右簇=终端 + 右栏(恒显);中段 drag。
 *  三键用 Codex 式自绘 glyph(PanelToggleIcon):分隔线滑动+填充、单色墨;hover 显柔底、开态常驻。 */
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
  // 单色墨 + squircle 柔底:静息浅墨无底、hover 深墨淡底、开态深墨常驻底(无投影)。
  const btn = (open: boolean): string =>
    'flex items-center rounded-[10px] p-1.5 transition-colors duration-150 active:scale-90 motion-reduce:transform-none [-webkit-app-region:no-drag] ' +
    (open ? 'bg-fg/[0.08] text-fg' : 'text-fg-muted hover:bg-fg/[0.06] hover:text-fg')
  return (
    <div data-testid="topbar" className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(platform)}>
      <button data-testid="sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} className={btn(!sidebarCollapsed)}>
        <PanelToggleIcon side="left" open={!sidebarCollapsed} />
      </button>
      <div className="flex-1" />
      {showChat && (
        <div className="flex items-center gap-1 pr-2">
          <button data-testid="terminal-toggle" onClick={onToggleTerminal} title="终端" className={btn(terminalOpen)}>
            <PanelToggleIcon side="bottom" open={terminalOpen} />
          </button>
          <button data-testid="rightdock-toggle" onClick={onToggleRightDock} title="右侧面板(浏览器/终端)" className={btn(rightDockOpen)}>
            <PanelToggleIcon side="right" open={rightDockOpen} />
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/topBarComponent.test.tsx`
Expected: PASS(原 3 用例 + 新 2 用例 = 5)。

- [ ] **Step 5: 全量单测 + typecheck**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 全绿(基线 943 + 本轮 Task1 新增 6 + Task2 新增 2 ≈ 951),typecheck 退出码 0。

- [ ] **Step 6: e2e sanity(TopBar 触及,跑一遍确认 testid/交互未破)**

Run: `cd desktop && npm run e2e`
Expected: 与基线一致 = 46 pass + 1 skip;唯 `T34` 为既有满载 flake(基线亦挂、隔离能过),非本改动回归。若除 T34 外有新失败,按 systematic-debugging 定位,勿绕过。

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/components/TopBar.tsx desktop/test/topBarComponent.test.tsx
git commit -m "feat(desktop): 顶栏三键接入 Codex 式 glyph + squircle 柔底(侧栏键起随折叠态变)"
```

---

## Self-Review(写完对照 spec)

**1. Spec coverage** —— spec 各节均有任务承接:
- glyph 组件(结构/三向几何/滑线动画/单色墨/reduced-motion)→ Task 1。
- TopBar 接线(三键映射 side/open、testid 保留、侧栏键反映折叠)→ Task 2 Step 3。
- squircle 柔底(hover 显 + 开态常驻、无投影、rounded-[10px])→ Task 2 `btn()`。
- 单色墨配色 → Task 1 `currentColor` + Task 2 `text-fg`/`text-fg-muted`。
- 测试(panelToggleIcon 新测 + topBarComponent 扩测、断语义属性)→ Task 1 Step 1 / Task 2 Step 1。
- e2e sanity → Task 2 Step 6。均覆盖,无缺口。

**2. Placeholder scan** —— 无 TBD/TODO;所有代码步骤含完整代码;命令含预期输出。

**3. Type consistency** —— `PanelSide`/`PanelToggleIcon` 签名在 Task 1 Produces 与 Task 2 Consumes 一致;`data-testid` 名(`panel-fill`/`panel-divider`)、`data-open`(字符串 `'true'`/`'false'`,由 `String(open)` 保证)、`data-side` 值在两任务测试中一致;`GEO` 键 `left`/`right`/`bottom` 与 `side` 取值一致;`--ease-smooth` 令牌名与 tokens.css 一致。
```
