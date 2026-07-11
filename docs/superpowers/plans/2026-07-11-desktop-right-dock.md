# 桌面右侧停靠列(A2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顶部工具条第二个按钮开/关一个右侧停靠列,列内分段切换「浏览器(内嵌 webview)」与「终端(复用 A1)」,列可拖宽、丝滑展开,与底部终端抽屉相互独立、可同时开。

**Architecture:** 纯函数(clampColumnWidth/normalizeUrl)先落地单测;从 A1 `TerminalDrawer` 抽出可复用 `TerminalPane`(tab+PTY 逻辑),底部抽屉与右侧列都嵌它;新增 `BrowserPane`(Electron `<webview>` + 地址栏/导航,开 webviewTag);`RightDock` 列壳做宽度动画/拖拽 + 分段切换,常挂两面板 CSS 显隐;App 把主内容与右侧列包成横向 flex + 第二个按钮。

**Tech Stack:** Electron + electron-vite;渲染 React/TS(`desktop/src/renderer/`)、主进程 TS;vitest。

## Global Constraints

- 浏览器是**用户浏览**用(非 agent);列内**一次显示一个**(分段切换);右侧列与底部抽屉**可同时开**;浏览器**单视图**(不做浏览器内多标签)。
- 常挂不卸载:收起 = 宽度过渡到 0 + `overflow-hidden`,webview 不销毁、PTY 不杀。
- webview 安全:`partition="persist:wraith-browser"`、`nodeintegration` 关、`allowpopups` 关。
- **A1 非破坏性重构**:抽 TerminalPane 后,底部抽屉(TerminalDrawer)对用户行为必须不变(多标签/切换保留/关标签杀/收起保留 PTY);`terminalTabs`/`ptyHelpers` 既有测试保持绿(接口不改)。
- 尺寸:列 min 320px / max 0.7×窗宽;宽度过渡 300ms ease-out,拖拽期关过渡。
- 测试:`cd desktop && npx vitest run <file>`;typecheck `npx tsc --noEmit -p tsconfig.json`。改主进程需重启 dev 眼验;webview/布局/动画/A1 回归靠眼验。

---

### Task 1: 纯函数 `clampColumnWidth` + `normalizeUrl`

**Files:**
- Create: `desktop/src/renderer/lib/rightDock.ts`
- Test: `desktop/test/rightDock.test.ts`

**Interfaces:**
- Produces: `clampColumnWidth(px: number, winW: number): number`;`normalizeUrl(input: string): string`

- [ ] **Step 1: 写失败测试**

```ts
// desktop/test/rightDock.test.ts
import { describe, it, expect } from 'vitest'
import { clampColumnWidth, normalizeUrl } from '../src/renderer/lib/rightDock'

describe('clampColumnWidth', () => {
  it('区间内原样', () => { expect(clampColumnWidth(500, 1200)).toBe(500) })
  it('低于 min(320)夹到 320', () => { expect(clampColumnWidth(100, 1200)).toBe(320) })
  it('高于 max(0.7*winW)夹到 max', () => { expect(clampColumnWidth(1000, 1200)).toBe(840) })
  it('窄窗:max 不低于 320', () => { expect(clampColumnWidth(500, 400)).toBe(320) })
})

describe('normalizeUrl', () => {
  it('空 → about:blank', () => { expect(normalizeUrl('   ')).toBe('about:blank') })
  it('无协议补 https://', () => { expect(normalizeUrl('example.com')).toBe('https://example.com') })
  it('已带协议原样', () => {
    expect(normalizeUrl('http://x.com')).toBe('http://x.com')
    expect(normalizeUrl('https://y.com/a?b=1')).toBe('https://y.com/a?b=1')
  })
  it('about: 原样', () => { expect(normalizeUrl('about:blank')).toBe('about:blank') })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/rightDock.test.ts`
Expected: FAIL(模块/导出不存在)

- [ ] **Step 3: 实现**

```ts
// desktop/src/renderer/lib/rightDock.ts
/** 右侧列宽度夹紧:min 320px,max = max(320, 0.7*窗宽)。 */
export function clampColumnWidth(px: number, winW: number): number {
  const hi = Math.max(320, Math.round(winW * 0.7))
  return Math.max(320, Math.min(hi, px))
}

/** 地址栏输入 → 可导航 URL:空→about:blank;已带协议(或 about:)原样;否则补 https://。 */
export function normalizeUrl(input: string): string {
  const t = (input || '').trim()
  if (!t) return 'about:blank'
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(t) || t.startsWith('about:')) return t
  return 'https://' + t
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/rightDock.test.ts`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/rightDock.ts desktop/test/rightDock.test.ts
git commit -m "feat(desktop/dock): clampColumnWidth + normalizeUrl 纯函数 + 单测"
```

---

### Task 2: 抽出 `TerminalPane`,`TerminalDrawer` 改为壳(非破坏性重构)

**Files:**
- Create: `desktop/src/renderer/components/TerminalPane.tsx`
- Modify: `desktop/src/renderer/components/TerminalDrawer.tsx`(改为高度 dock 壳 + 渲染 TerminalPane)

**Interfaces:**
- Consumes: `terminalTabs`(addTab/closeTab/setActive/shortTabLabel/TabsState)、`TerminalTab`(A1 既有)
- Produces: `TerminalPane`,props `{ active: boolean; cwd: string | null; onAllClosed?: () => void; rightSlot?: React.ReactNode }`
  - `active && 无标签` 时自动建首标签(deps [active],关标签到空不自动重建);关最后一个标签时调 `onAllClosed?.()`;`rightSlot` 渲染在标签栏最右(供 dock 注入收起按钮)。

- [ ] **Step 1: 创建 TerminalPane(从 TerminalDrawer 迁移 tab/PTY 逻辑)**

```tsx
// desktop/src/renderer/components/TerminalPane.tsx
import { useCallback, useEffect, useState } from 'react'
import { Plus, SquareTerminal } from 'lucide-react'
import TerminalTab from './TerminalTab'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../lib/terminalTabs'

/** 终端面板:多标签 xterm + PTY 管理(不含任何 dock 特有的尺寸拖拽)。
 * 底部抽屉与右侧列都嵌它;active 控制自动建首标签与聚焦;rightSlot 供 dock 注入收起按钮。 */
export default function TerminalPane(
  { active, cwd, onAllClosed, rightSlot }:
  { active: boolean; cwd: string | null; onAllClosed?: () => void; rightSlot?: React.ReactNode },
): JSX.Element {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })

  const addNew = useCallback(async () => {
    try {
      const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined })
      if (!id) return
      setState(s => addTab(s, { id, label: shortTabLabel(cwd ?? '', s.tabs.length) }))
    } catch { /* 创建失败:忽略,用户可重试 */ }
  }, [cwd])

  // active 且无标签时自动建一个(deps [active];关到空不自动重建)
  useEffect(() => {
    if (active && state.tabs.length === 0) void addNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const close = (id: string): void => {
    void window.wraith.ptyKill(id)
    setState(s => {
      const ns = closeTab(s, id)
      if (ns.tabs.length === 0) onAllClosed?.()
      return ns
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标签栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <SquareTerminal className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <button data-testid="terminal-tab" onClick={() => setState(s => setActive(s, t.id))} className="max-w-[140px] truncate">{t.label}</button>
            <button data-testid="terminal-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="terminal-add" onClick={() => void addNew()} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建终端"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        {rightSlot && <div className="ml-auto flex items-center">{rightSlot}</div>}
      </div>
      {/* 全标签常挂,CSS 显隐 */}
      <div className="relative min-h-0 flex-1">
        {state.tabs.map(t => (
          <div key={t.id} className={'absolute inset-0 px-2 py-1 ' + (t.id === state.activeId ? '' : 'hidden')}>
            <TerminalTab id={t.id} active={t.id === state.activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TerminalDrawer 改为高度 dock 壳(渲染 TerminalPane)**

用以下**完整内容替换** `desktop/src/renderer/components/TerminalDrawer.tsx`:
```tsx
// desktop/src/renderer/components/TerminalDrawer.tsx
import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import TerminalPane from './TerminalPane'

const MIN_H = 120

/** 底部终端抽屉:高度 dock 壳(顶边拖拽调高 + open 高度动画)+ 内嵌 TerminalPane。
 * 常驻挂载;open=false → 高度过渡到 0(丝滑收起,PTY 不丢);拖拽期关过渡。 */
export default function TerminalDrawer({ open, cwd, onClose }: { open: boolean; cwd: string | null; onClose: () => void }): JSX.Element {
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startY: e.clientY, startH: height }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const next = Math.min(window.innerHeight * 0.8, Math.max(MIN_H, d.startH + (d.startY - e.clientY)))
    setHeight(next)
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    dragRef.current = null
    setDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div data-testid="terminal-drawer"
      className={'flex flex-col overflow-hidden bg-surface '
        + (open ? 'border-t border-border ' : '')
        + (dragging ? '' : 'transition-[height] duration-300 ease-out')}
      style={{ height: open ? height : 0 }}>
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        className="h-1.5 shrink-0 cursor-ns-resize hover:bg-accent/30" />
      <TerminalPane
        active={open}
        cwd={cwd}
        onAllClosed={onClose}
        rightSlot={
          <button data-testid="terminal-drawer-close" onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        }
      />
    </div>
  )
}
```

- [ ] **Step 3: typecheck + 回归**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exit 0;vitest 全绿(terminalTabs/ptyHelpers 等既有测试不受影响)。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/TerminalPane.tsx desktop/src/renderer/components/TerminalDrawer.tsx
git commit -m "refactor(desktop/term): 抽出 TerminalPane,TerminalDrawer 改为高度 dock 壳(A1 行为不变)"
```

(A1 底部抽屉行为回归留待 Task 5 眼验一并核对。)

---

### Task 3: `BrowserPane`(内嵌 webview)+ 开启 webviewTag

**Files:**
- Create: `desktop/src/renderer/components/BrowserPane.tsx`
- Modify: `desktop/src/main/index.ts`(createWindow 的 webPreferences 加 `webviewTag: true`)

**Interfaces:**
- Consumes: `normalizeUrl`(Task 1)
- Produces: `BrowserPane`,props `{ active: boolean }`

- [ ] **Step 1: 主窗开启 webviewTag**

在 `desktop/src/main/index.ts` 的 `createWindow` 里,`mainWindow = new BrowserWindow({...})` 的 `webPreferences` 中加 `webviewTag: true`(与 `contextIsolation`/`preload` 并列):
```ts
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      webviewTag: true
    }
```

- [ ] **Step 2: 实现 BrowserPane**

```tsx
// desktop/src/renderer/components/BrowserPane.tsx
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { normalizeUrl } from '../lib/rightDock'

/** Electron webview 元素的最小类型(仅用到的方法)。 */
interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
}

/** 内嵌浏览器:地址栏 + 前进/后退/刷新 + <webview>(独立 partition、隔离)。用户浏览用。 */
export default function BrowserPane({ active }: { active: boolean }): JSX.Element {
  const wv = useRef<WebviewEl | null>(null)
  const [addr, setAddr] = useState('')       // 地址栏输入
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // 绑定 webview DOM 事件(导航/加载态/失败)
  useEffect(() => {
    const el = wv.current
    if (!el) return
    const onStart = (): void => { setLoading(true); setFailed(false) }
    const onStop = (): void => { setLoading(false); try { setAddr(el.getURL()) } catch { /* ignore */ } }
    const onNav = (): void => { try { setAddr(el.getURL()) } catch { /* ignore */ } }
    const onFail = (e: Event): void => {
      // 主框架加载失败才标记(忽略子资源/-3 取消)
      const ev = e as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (ev.isMainFrame !== false && ev.errorCode !== -3) { setLoading(false); setFailed(true) }
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('did-fail-load', onFail as EventListener)
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('did-fail-load', onFail as EventListener)
    }
  }, [])

  const navigate = useCallback((raw: string) => {
    const url = normalizeUrl(raw)
    setFailed(false)
    void wv.current?.loadURL(url).catch(() => setFailed(true))
  }, [])

  const btn = 'rounded p-1 text-fg-muted hover:bg-surface/60 disabled:opacity-40'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 地址栏 + 导航 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <button className={btn} title="后退" onClick={() => wv.current?.goBack()}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="前进" onClick={() => wv.current?.goForward()}><ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="刷新" onClick={() => wv.current?.reload()}><RotateCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} strokeWidth={1.5} /></button>
        <input
          data-testid="browser-addr"
          value={addr}
          onChange={e => setAddr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(addr) }}
          placeholder="输入网址回车访问"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-2xs text-fg outline-none focus:border-accent"
        />
      </div>
      {/* webview 主体 */}
      <div className="relative min-h-0 flex-1">
        {failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-xs text-fg-subtle">页面加载失败</div>
        )}
        {createElement('webview', {
          ref: wv,
          src: 'about:blank',
          partition: 'persist:wraith-browser',
          allowpopups: undefined,
          style: { width: '100%', height: '100%', display: 'flex' },
        })}
      </div>
    </div>
  )
}
```
注:`active` 目前不驱动逻辑(webview 常挂,切走用 CSS 隐藏由父级 RightDock 控制);保留 prop 以备将来(如切走暂停媒体)。不引入未用告警——在 RightDock 用它控制显隐即可,BrowserPane 内可暂不读;若 lint 报未用参数,改为 `{ active: _active }` 或用 `void active`。

- [ ] **Step 3: typecheck + 回归**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exit 0(webview 经 `createElement` 字符串标签,无需 JSX intrinsic 声明);vitest 全绿。
注:webview 运行时行为(真实加载网页)在 Task 5 眼验。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/BrowserPane.tsx desktop/src/main/index.ts
git commit -m "feat(desktop/browser): 内嵌 webview 浏览器面板(地址栏+导航)+ 开启 webviewTag"
```

---

### Task 4: `RightDock` 列壳 + App 集成

**Files:**
- Create: `desktop/src/renderer/components/RightDock.tsx`
- Modify: `desktop/src/renderer/App.tsx`(rightDockOpen 状态 + 第二个按钮 + 横向 flex 包裹)

**Interfaces:**
- Consumes: `clampColumnWidth`(Task 1)、`BrowserPane`(Task 3)、`TerminalPane`(Task 2)
- Produces: `RightDock`,props `{ open: boolean; cwd: string | null; onClose: () => void }`

- [ ] **Step 1: 实现 RightDock**

```tsx
// desktop/src/renderer/components/RightDock.tsx
import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import BrowserPane from './BrowserPane'
import TerminalPane from './TerminalPane'
import { clampColumnWidth } from '../lib/rightDock'

/** 右侧停靠列:分段切换 浏览器|终端,常挂两面板 CSS 显隐;左边缘拖拽调宽;open 宽度动画。 */
export default function RightDock({ open, cwd, onClose }: { open: boolean; cwd: string | null; onClose: () => void }): JSX.Element {
  const [pane, setPane] = useState<'browser' | 'terminal'>('browser')
  const [width, setWidth] = useState(() => clampColumnWidth(Math.round(window.innerWidth * 0.4), window.innerWidth))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startX: e.clientX, startW: width }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    // 左边缘:向左拖变宽
    setWidth(clampColumnWidth(d.startW + (d.startX - e.clientX), window.innerWidth))
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    dragRef.current = null
    setDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const seg = (id: 'browser' | 'terminal', label: string): JSX.Element => (
    <button data-testid={`rightdock-seg-${id}`} onClick={() => setPane(id)}
      className={'rounded-md px-2 py-0.5 text-2xs ' + (pane === id ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>{label}</button>
  )

  return (
    <div data-testid="right-dock"
      className={'flex shrink-0 flex-row overflow-hidden bg-surface '
        + (open ? 'border-l border-border ' : '')
        + (dragging ? '' : 'transition-[width] duration-300 ease-out')}
      style={{ width: open ? width : 0 }}>
      {/* 左边缘拖拽手柄 */}
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        className="w-1.5 shrink-0 cursor-ew-resize hover:bg-accent/30" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 分段切换 + 收起 */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          {seg('browser', '浏览器')}
          {seg('terminal', '终端')}
          <button data-testid="right-dock-close" onClick={onClose} className="ml-auto rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        </div>
        {/* 两面板常挂,CSS 显隐 */}
        <div className="relative min-h-0 flex-1">
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'browser' ? '' : 'hidden')}>
            <BrowserPane active={open && pane === 'browser'} />
          </div>
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'terminal' ? '' : 'hidden')}>
            <TerminalPane active={open && pane === 'terminal'} cwd={cwd} />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: App 集成 —— 第二个按钮 + 横向 flex 包裹**

在 `App.tsx` import 区加:`import RightDock from './components/RightDock'`;lucide 加 `PanelRight`(并入既有 lucide import)。
App 状态区加:`const [rightDockOpen, setRightDockOpen] = useState(false)`。
在顶部工具条(终端开关按钮旁,`terminal-toggle` 之后)加第二个按钮:
```tsx
<button data-testid="rightdock-toggle" onClick={() => setRightDockOpen(v => !v)}
  className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-surface hover:text-fg ' + (rightDockOpen ? 'text-accent' : 'text-fg-muted')}
  title="右侧面板(浏览器/终端)">
  <PanelRight className="h-4 w-4" strokeWidth={1.5} />
</button>
```
把「主内容包裹层」与右侧列包成横向 flex:现有结构约 App.tsx:837 为
```tsx
<div className="relative flex min-w-0 flex-1 flex-col">
  … 主内容(banner / view 切换 / chat 等)…
</div>
```
将其**外面再套一层横向 flex**,并在其后放 RightDock:
```tsx
<div className="flex min-w-0 flex-1 flex-row">
  <div className="relative flex min-w-0 flex-1 flex-col">
    … 原主内容整体 …
  </div>
  <RightDock open={rightDockOpen} cwd={state.workspace ?? null} onClose={() => setRightDockOpen(false)} />
</div>
```
(即:把原本紧跟 `<Sidebar/>` 之后的那个 `<div className="relative flex min-w-0 flex-1 flex-col">…</div>` 整块,包进一个新的 `flex flex-row` 容器,并在其内、该 div 之后加 `<RightDock/>`。确保新容器 `flex-1` 撑满、原主内容 `flex-1`、RightDock `shrink-0`。)

- [ ] **Step 3: typecheck + 回归**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exit 0;vitest 全绿(含 Task 1 rightDock 测试)。

- [ ] **Step 4: 眼验(重启 dev —— 含主进程 webviewTag 改动)**

重启 `npm run dev`。核对:
- 顶部工具条**第二个按钮**开/关右侧列;列从右缘**丝滑展开**;拖左边缘调宽(min 320 / max 70%)。
- 分段切「浏览器」:地址栏输 `example.com` 回车能打开;前进/后退/刷新可用;加载失败显文案。
- 分段切「终端」:复用 A1 终端(多标签/命令/resize);切回浏览器,页面仍在(常挂)。
- 右侧列与**底部终端抽屉可同时开**、互不干扰。收起再开:webview 页面与终端会话都保留。
- **A1 回归**:底部终端抽屉行为与重构前一致(多标签/切换保留/关标签杀/收起保留 PTY)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop/dock): 右侧停靠列(分段切换 浏览器|终端 + 拖宽 + 丝滑展开)+ 工具条第二按钮"
```

---

## Self-Review

**Spec coverage:**
- 第二个按钮开/关右侧列 → Task 4 Step 2 ✓
- 分段切换 浏览器|终端(一次一个,常挂 CSS 显隐)→ Task 4 RightDock ✓
- 内嵌浏览器(webview + 地址栏 + 前进/后退/刷新 + partition/nodeintegration 关/allowpopups 关)→ Task 3 BrowserPane + webviewTag ✓
- 终端复用 A1(抽 TerminalPane,TerminalDrawer 非破坏性重构)→ Task 2 ✓
- 列可拖宽(clampColumnWidth min320/max0.7)+ 丝滑宽度动画(拖拽关过渡)→ Task 1 + Task 4 ✓
- 与底部抽屉可同时开、相互独立 → Task 4(RightDock 独立于 TerminalDrawer)✓
- normalizeUrl 补协议 → Task 1 + Task 3 导航 ✓
- 收起常挂不销毁(webview/PTY 保留)→ RightDock width0+overflow-hidden 常挂 ✓
- 浏览器单视图(不做多标签)→ BrowserPane 单 webview ✓

**Placeholder scan:** 无 TBD/TODO;组件代码完整;`active` 未用的处理已给明确指引(RightDock 控显隐;必要时 `void active`)。

**Type consistency:** `clampColumnWidth`/`normalizeUrl`(T1)→ T4/T3 消费一致;`TerminalPane` props(active/cwd/onAllClosed/rightSlot)T2 定义、T2 TerminalDrawer 与 T4 RightDock 消费一致;`BrowserPane`/`RightDock` props 一致;webview 经 `createElement` 无需 JSX intrinsic。

**已知风险:** ①webviewTag 开启后全窗可用 webview(用 partition+关 nodeintegration/allowpopups 收敛);②TerminalPane 抽取后 A1 底部抽屉回归(Task 5 眼验重点);③App 横向 flex 包裹须不破坏既有主内容布局(定位现有 837 包裹层,整体外套一层)。
