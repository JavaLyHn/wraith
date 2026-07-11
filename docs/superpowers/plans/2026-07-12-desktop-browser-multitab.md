# 内嵌浏览器多标签重设计(BrowserPane)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右侧停靠列里的内嵌浏览器 `BrowserPane` 从单视图升级为真·多标签浏览器(每标签一个常挂 `<webview>`),含精致空态、跟随活动标签的地址栏、go 前往按钮、前进后退禁用态。

**Architecture:** 三个单元:纯函数标签簿 `lib/browserTabs.ts`(镜像现有 `terminalTabs.ts` 的加/关/切逻辑,标签带浏览器状态)→ 单标签组件 `components/BrowserWebview.tsx`(一个 `<webview>` + 事件上抛 + 把 DOM ref 注册给父层)→ 容器 `components/BrowserPane.tsx` 重写(标签条 + 工具条 + 空/失败态 + 生命周期)。`RightDock` 与主进程零改动(`BrowserPane` props 仍为 `{ active }`;`webviewTag`/partition 权限/弹窗 deny 已就绪)。

**Tech Stack:** Electron + electron-vite;渲染层 React 18 + TypeScript;Tailwind(主题 token 见 `src/renderer/styles/tokens.css`);lucide-react 图标;vitest(测试在 `desktop/test/*.test.ts`,`import from '../src/renderer/lib/...'`)。

## Global Constraints

- 所有命令在 `desktop/` 目录下执行(该子项目根)。
- 类型检查:`npm run typecheck`(`tsc --noEmit -p tsconfig.json`),须 **exit 0 无输出**。
- 测试:`npx vitest run test/<file>` 跑单文件;`npm test` 跑全量,基线 **625 passed** 须保持不降。
- 密钥只存 `~/.wraith/config.json`,绝不进日志/RPC/renderer(本计划纯前端 UI,不接触密钥;不得新增任何读密钥/写 config 的代码)。
- 安全面不新增放权:所有 `<webview>` 共用 `partition: 'persist:wraith-browser'`,`allowpopups` 传 **`undefined`**(切勿改 `false`);已有的 partition deny-all 权限处理器与 `web-contents-created` 弹窗 deny 自动覆盖新 webview,不在本计划改动主进程。
- 组件命名/视觉与 `TerminalPane`(`src/renderer/components/TerminalPane.tsx`)标签栏保持一致:`text-2xs`、`gap-1`、`px-2 py-1`、圆角 `rounded-md`、活动 `bg-surface text-fg`、非活动 `text-fg-muted hover:bg-surface/60`。
- 不用 `Math.random()` 生成标签 id;用组件内递增序号 `btab-<n>`。
- **push 需用户单独点头**(实现阶段只本地提交,不 push)。

---

### Task 1: `lib/browserTabs.ts` 纯函数标签簿 + 单测

**Files:**
- Create: `desktop/src/renderer/lib/browserTabs.ts`
- Test: `desktop/test/browserTabs.test.ts`

**Interfaces:**
- Consumes: 无(独立纯模块)。参考同目录 `terminalTabs.ts` 的 `closeTab` 邻居选择逻辑作范式。
- Produces(后续 Task 2/3 依赖这些确切签名):
  - `interface BrowserTab { id: string; title: string; url: string; loading: boolean; failed: boolean; canBack: boolean; canForward: boolean }`
  - `interface BrowserTabsState { tabs: BrowserTab[]; activeId: string | null }`
  - `newBrowserTab(id: string): BrowserTab`
  - `addBrowserTab(state: BrowserTabsState, tab: BrowserTab): BrowserTabsState`
  - `closeBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState`
  - `setActiveBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState`
  - `patchBrowserTab(state: BrowserTabsState, id: string, patch: Partial<BrowserTab>): BrowserTabsState`

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/browserTabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  newBrowserTab, addBrowserTab, closeBrowserTab, setActiveBrowserTab, patchBrowserTab,
  type BrowserTabsState,
} from '../src/renderer/lib/browserTabs'

const empty: BrowserTabsState = { tabs: [], activeId: null }

describe('newBrowserTab', () => {
  it('空白标签默认字段', () => {
    expect(newBrowserTab('x')).toEqual({
      id: 'x', title: '新标签页', url: '', loading: false, failed: false, canBack: false, canForward: false,
    })
  })
})

describe('addBrowserTab', () => {
  it('追加并激活新标签', () => {
    const s = addBrowserTab(empty, newBrowserTab('a'))
    expect(s.tabs.map(t => t.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
    const s2 = addBrowserTab(s, newBrowserTab('b'))
    expect(s2.tabs.map(t => t.id)).toEqual(['a', 'b'])
    expect(s2.activeId).toBe('b')
  })
})

describe('closeBrowserTab', () => {
  const three: BrowserTabsState = {
    tabs: [newBrowserTab('a'), newBrowserTab('b'), newBrowserTab('c')], activeId: 'b',
  }
  it('关活动标签 → 激活左邻居', () => {
    const s = closeBrowserTab(three, 'b')
    expect(s.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('a')
  })
  it('关第一个(活动)→ 激活右邻居', () => {
    const s = closeBrowserTab({ ...three, activeId: 'a' }, 'a')
    expect(s.activeId).toBe('b')
  })
  it('关非活动标签 → 活动不变', () => {
    const s = closeBrowserTab(three, 'c')
    expect(s.activeId).toBe('b')
  })
  it('关到空 → activeId null', () => {
    const s = closeBrowserTab({ tabs: [newBrowserTab('a')], activeId: 'a' }, 'a')
    expect(s.tabs).toEqual([])
    expect(s.activeId).toBeNull()
  })
  it('关不存在 id → 原样返回', () => {
    const s = closeBrowserTab(three, 'zzz')
    expect(s).toBe(three)
  })
})

describe('setActiveBrowserTab', () => {
  const s0: BrowserTabsState = { tabs: [newBrowserTab('a'), newBrowserTab('b')], activeId: 'a' }
  it('存在才切', () => {
    expect(setActiveBrowserTab(s0, 'b').activeId).toBe('b')
  })
  it('不存在 id → 原样', () => {
    expect(setActiveBrowserTab(s0, 'zzz')).toBe(s0)
  })
})

describe('patchBrowserTab', () => {
  const s0: BrowserTabsState = { tabs: [newBrowserTab('a'), newBrowserTab('b')], activeId: 'a' }
  it('只更新目标标签的指定字段(浅合并)', () => {
    const s = patchBrowserTab(s0, 'b', { title: 'X', loading: true })
    const b = s.tabs.find(t => t.id === 'b')!
    expect(b.title).toBe('X')
    expect(b.loading).toBe(true)
    expect(b.url).toBe('')          // 未传的字段保持
    expect(s.tabs.find(t => t.id === 'a')!.title).toBe('新标签页')  // 其他标签不动
    expect(s.activeId).toBe('a')
  })
  it('不存在 id → 原样、不新增', () => {
    const s = patchBrowserTab(s0, 'zzz', { title: 'X' })
    expect(s).toBe(s0)
    expect(s.tabs.length).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/browserTabs.test.ts`
Expected: FAIL —— 报 `browserTabs` 模块/导出不存在(无法解析 `../src/renderer/lib/browserTabs`)。

- [ ] **Step 3: 写实现**

创建 `desktop/src/renderer/lib/browserTabs.ts`:

```ts
export interface BrowserTab {
  id: string
  title: string
  url: string
  loading: boolean
  failed: boolean
  canBack: boolean
  canForward: boolean
}
export interface BrowserTabsState { tabs: BrowserTab[]; activeId: string | null }

export function newBrowserTab(id: string): BrowserTab {
  return { id, title: '新标签页', url: '', loading: false, failed: false, canBack: false, canForward: false }
}

export function addBrowserTab(state: BrowserTabsState, tab: BrowserTab): BrowserTabsState {
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function closeBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  const idx = state.tabs.findIndex(t => t.id === id)
  if (idx < 0) return state
  const tabs = state.tabs.filter(t => t.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    if (tabs.length === 0) activeId = null
    else activeId = (state.tabs[idx - 1] ?? state.tabs[idx + 1])?.id ?? tabs[0]!.id
  }
  return { tabs, activeId }
}

export function setActiveBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  return state.tabs.some(t => t.id === id) ? { ...state, activeId: id } : state
}

export function patchBrowserTab(state: BrowserTabsState, id: string, patch: Partial<BrowserTab>): BrowserTabsState {
  if (!state.tabs.some(t => t.id === id)) return state
  return { ...state, tabs: state.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/browserTabs.test.ts`
Expected: PASS(全部用例通过)。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/lib/browserTabs.ts desktop/test/browserTabs.test.ts
git commit -m "feat(desktop/browser): browserTabs 纯函数标签簿 + 单测"
```

---

### Task 2: `components/BrowserWebview.tsx` 单标签 webview

**Files:**
- Create: `desktop/src/renderer/components/BrowserWebview.tsx`

**Interfaces:**
- Consumes(Task 1):`import { type BrowserTab } from '../lib/browserTabs'`。
- Produces(Task 3 依赖):
  - `export interface WebviewEl extends HTMLElement { src: string; canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void; reload(): void; loadURL(url: string): Promise<void>; getURL(): string; getTitle(): string }`
  - default export `BrowserWebview`,props:`{ tab: BrowserTab; active: boolean; onState: (id: string, patch: Partial<BrowserTab>) => void; registerRef: (id: string, el: WebviewEl | null) => void }`

**说明:** `<webview>` 无法在 jsdom 里真实运行,本任务无单元测试;验收 = `npm run typecheck` 通过 + 全量 `npm test` 保持 625 绿(不引入回归),真实行为在 Task 3 完成后一并眼验。此处仅新增文件、不接入,所以对运行时零影响。

- [ ] **Step 1: 写组件**

创建 `desktop/src/renderer/components/BrowserWebview.tsx`。注意 `createElement('webview', …)` 是刻意用法(webview 非 JSX 内建元素,直接写 `<webview>` 会触发 TS 内建类型报错;现有代码即用此法),`allowpopups: undefined` 的注释必须原样保留:

```tsx
import { createElement, useEffect, useRef } from 'react'
import type { BrowserTab } from '../lib/browserTabs'

/** Electron webview 元素的最小类型(仅用到的方法)。 */
export interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
}

const displayUrl = (u: string): string => (u === 'about:blank' ? '' : u)

/** 单个标签的内嵌 webview:绑导航/加载/标题/失败事件经 onState(id,patch) 上抛;
 * 挂载时把 DOM ref 注册给父层(供工具条驱动导航),卸载置 null;!active 时 CSS 隐藏、常挂不销毁。 */
export default function BrowserWebview(
  { tab, active, onState, registerRef }:
  { tab: BrowserTab; active: boolean; onState: (id: string, patch: Partial<BrowserTab>) => void; registerRef: (id: string, el: WebviewEl | null) => void },
): JSX.Element {
  const wv = useRef<WebviewEl | null>(null)
  const id = tab.id

  useEffect(() => {
    const el = wv.current
    if (!el) return
    registerRef(id, el)
    const onStart = (): void => onState(id, { loading: true, failed: false })
    const onStop = (): void => {
      try { onState(id, { loading: false, url: displayUrl(el.getURL()), title: el.getTitle() || '新标签页', canBack: el.canGoBack(), canForward: el.canGoForward() }) }
      catch { onState(id, { loading: false }) }
    }
    const onNav = (): void => {
      try { onState(id, { url: displayUrl(el.getURL()), canBack: el.canGoBack(), canForward: el.canGoForward() }) } catch { /* ignore */ }
    }
    const onTitle = (e: Event): void => {
      const ev = e as unknown as { title?: string }
      onState(id, { title: ev.title || '新标签页' })
    }
    const onFail = (e: Event): void => {
      // 仅主框架失败才标记(忽略子资源 / -3 用户取消)
      const ev = e as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (ev.isMainFrame !== false && ev.errorCode !== -3) onState(id, { loading: false, failed: true })
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('page-title-updated', onTitle as EventListener)
    el.addEventListener('did-fail-load', onFail as EventListener)
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('page-title-updated', onTitle as EventListener)
      el.removeEventListener('did-fail-load', onFail as EventListener)
      registerRef(id, null)
    }
    // 仅按标签 id 绑一次;onState/registerRef 由父层 useCallback 稳定,故不入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className={'absolute inset-0 ' + (active ? '' : 'hidden')}>
      {createElement('webview', {
        ref: wv,
        src: 'about:blank',
        partition: 'persist:wraith-browser',
        // 必须用 undefined(=不写该属性)来关弹窗;传 false 会渲染成 allowpopups="false" 字符串,
        // Electron 按"属性存在"判定反而开启弹窗。切勿改为 false。
        allowpopups: undefined,
        style: { width: '100%', height: '100%', display: 'flex' },
      })}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。

- [ ] **Step 3: 全量测试保持绿**

Run: `npm test`
Expected: 全部通过,数量为基线 625 + Task 1 新增(即不低于 625),无新增失败。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/BrowserWebview.tsx
git commit -m "feat(desktop/browser): BrowserWebview 单标签 webview(事件上抛 + ref 注册)"
```

---

### Task 3: `components/BrowserPane.tsx` 重写为多标签容器

**Files:**
- Modify(整体重写): `desktop/src/renderer/components/BrowserPane.tsx`

**Interfaces:**
- Consumes:
  - Task 1:`addBrowserTab / closeBrowserTab / newBrowserTab / patchBrowserTab / setActiveBrowserTab`、类型 `BrowserTab / BrowserTabsState`(from `'../lib/browserTabs'`)。
  - Task 2:`BrowserWebview` default + `type WebviewEl`(from `'./BrowserWebview'`)。
  - 既有:`normalizeUrl`(from `'../lib/rightDock'`,空串 → `'about:blank'`)。
- Produces:default export `BrowserPane`,props 保持 `{ active: boolean }`(`RightDock` 已如此调用,**不改 RightDock**)。

**说明:** 组件含 `<webview>`,无 jsdom 单测;验收 = `npm run typecheck` + 全量 `npm test` 保持绿 + Task 3 后的**眼验清单**(见 Step 4)。当前单视图版 `BrowserPane.tsx`(含 `WebviewEl` 接口、`did-*` 事件、`about:blank`→空 的 `displayUrl` 修复)整体被本任务取代:`WebviewEl` 迁至 `BrowserWebview.tsx`、`displayUrl` 逻辑随之迁入,不回退该修复。

- [ ] **Step 1: 整体重写 `BrowserPane.tsx`**

用以下完整内容替换 `desktop/src/renderer/components/BrowserPane.tsx` 的全部内容:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, Plus, RotateCw } from 'lucide-react'
import BrowserWebview, { type WebviewEl } from './BrowserWebview'
import {
  addBrowserTab, closeBrowserTab, newBrowserTab, patchBrowserTab, setActiveBrowserTab,
  type BrowserTab, type BrowserTabsState,
} from '../lib/browserTabs'
import { normalizeUrl } from '../lib/rightDock'

/** 内嵌浏览器:多标签(每标签一个常挂 webview)+ 地址栏/导航 + 精致空态。用户浏览用。 */
export default function BrowserPane({ active }: { active: boolean }): JSX.Element {
  const [state, setState] = useState<BrowserTabsState>({ tabs: [], activeId: null })
  const [addr, setAddr] = useState('')
  const refs = useRef<Map<string, WebviewEl>>(new Map())
  const seq = useRef(0)
  const addrInput = useRef<HTMLInputElement>(null)

  const activeTab: BrowserTab | undefined = state.tabs.find(t => t.id === state.activeId)

  // 稳定回调:BrowserWebview 只在挂载时绑一次,靠这两个稳定引用
  const registerRef = useCallback((id: string, el: WebviewEl | null) => {
    if (el) refs.current.set(id, el)
    else refs.current.delete(id)
  }, [])
  const onState = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setState(s => patchBrowserTab(s, id, patch))
  }, [])

  const addNew = useCallback(() => {
    const id = 'btab-' + (++seq.current)
    setState(s => addBrowserTab(s, newBrowserTab(id)))
  }, [])

  // active 且无标签时自动建首标签(deps [active];关到空由 close 内部补,不靠此重建)
  useEffect(() => {
    if (active && state.tabs.length === 0) addNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 地址栏跟随活动标签:仅切标签或该标签真实导航(url 变)时回灌;
  // 用户打字只改本地 addr,不触发导航、也不被覆盖(activeTab.url 仅真实导航时变)
  useEffect(() => {
    setAddr(activeTab?.url ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeId, activeTab?.url])

  const close = (id: string): void => {
    refs.current.delete(id)
    setState(s => {
      const ns = closeBrowserTab(s, id)
      if (ns.tabs.length === 0) {
        const nid = 'btab-' + (++seq.current)
        return addBrowserTab(ns, newBrowserTab(nid))   // 关到空自动补新空白标签(永不空)
      }
      return ns
    })
  }

  const navigate = (raw: string): void => {
    const id = state.activeId
    if (!id) return
    const url = normalizeUrl(raw)
    setState(s => patchBrowserTab(s, id, { failed: false }))
    void refs.current.get(id)?.loadURL(url).catch(() => setState(s => patchBrowserTab(s, id, { failed: true })))
  }

  const btn = 'rounded p-1 text-fg-muted hover:bg-surface/60 disabled:opacity-40'
  const showEmpty = !!activeTab && activeTab.url === '' && !activeTab.loading && !activeTab.failed

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标签条 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <Globe className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <button data-testid="browser-tab" onClick={() => setState(s => setActiveBrowserTab(s, t.id))} className="max-w-[120px] truncate">{t.title}</button>
            <button data-testid="browser-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="browser-add" onClick={addNew} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建标签页"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* 工具条:后退/前进/刷新 + 地址栏 + 前往 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <button className={btn} title="后退" disabled={!activeTab?.canBack} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.goBack() }}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="前进" disabled={!activeTab?.canForward} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.goForward() }}><ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="刷新" disabled={!activeTab} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.reload() }}><RotateCw className={'h-3.5 w-3.5 ' + (activeTab?.loading ? 'animate-spin' : '')} strokeWidth={1.5} /></button>
        <input
          ref={addrInput}
          data-testid="browser-addr"
          value={addr}
          onChange={e => setAddr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(addr) }}
          placeholder="输入 URL"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-2xs text-fg outline-none focus:border-accent"
        />
        <button className={btn} title="前往" disabled={!activeTab} onClick={() => navigate(addr)}><ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* webview 栈(全常挂,CSS 显隐)+ 空态/失败态覆盖 */}
      <div className="relative min-h-0 flex-1">
        {state.tabs.map(t => (
          <BrowserWebview key={t.id} tab={t} active={t.id === state.activeId} onState={onState} registerRef={registerRef} />
        ))}
        {showEmpty && (
          <button
            data-testid="browser-empty"
            onClick={() => addrInput.current?.focus()}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg text-fg-subtle">
            <Globe className="h-16 w-16" strokeWidth={1} />
            <div className="text-sm font-semibold text-fg">开始浏览</div>
            <div className="text-xs text-fg-subtle">输入 URL 以打开页面</div>
          </button>
        )}
        {activeTab?.failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-xs text-fg-subtle">页面加载失败</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。若报 `WebviewEl` 未导出 → 确认 Task 2 的 `export interface WebviewEl`;若报 lucide 图标名 → 确认 `ArrowUpRight`/`Globe` 均为 lucide-react 有效导出(是)。

- [ ] **Step 3: 全量测试保持绿**

Run: `npm test`
Expected: 全部通过,不低于 625,无新增失败(`rightDock`/`terminalTabs`/`ptyHelpers` 等既有测试不受影响)。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/BrowserPane.tsx
git commit -m "feat(desktop/browser): BrowserPane 重写为多标签(标签条+工具条+空态+go)"
```

**眼验清单(实现者不执行,交回控制者/用户,须重启 `npm run dev`——含渲染层组件重写,HMR 一般可热更,但 webview 行为建议整刷):**
- 开右侧列到「浏览器」→ 自动出一个空白标签,显示空态(大地球 + 开始浏览 + 输入 URL 以打开页面)。
- 地址栏输入网址回车 / 点 go(↗)→ 加载页面,空态消失;地址栏跟随实际 URL。
- 打字过程中地址栏不被导航事件覆盖。
- `+` 开多个标签;点标签切换,各自页面保留;`←/→` 禁用态随该标签导航历史变化;`⟳` 刷新(加载时转圈)。
- 关标签选邻居;关到最后一个 → 自动补一个新空白标签(不留空、不关列)。
- 加载失败(如断网访问)→「页面加载失败」,再导航恢复。
- 切「终端」再切回「浏览器」→ 标签与页面保留;右侧列与底部终端抽屉同时开互不干扰;收起再展开保留。
- 深浅色主题下标签条/工具条/空态视觉正常。

---

## Self-Review(计划对 spec 的自查)

**1. Spec coverage:**
- `browserTabs.ts` 全部纯函数 → Task 1(含 newBrowserTab/add/close/setActive/patch 全测)。✓
- `BrowserWebview.tsx`(webview + 事件上抛 + registerRef + displayUrl + allowpopups undefined + !active hidden 常挂)→ Task 2。✓
- `BrowserPane.tsx`(标签条 / 工具条 / go / 前进后退禁用 / 地址栏受控+回灌 / 空态点击聚焦 / 失败态 / webview 栈常挂 / active&&空自动建 / genId 递增 / 关到空补新)→ Task 3。✓
- RightDock/主进程零改动 → 计划未列改动任务,Global Constraints 明示不碰。✓
- 测试:browserTabs vitest + 既有测试保绿 → Task 1 Step 4 / Task 2·3 Step 3。✓

**2. Placeholder scan:** 无 TBD/TODO/"类似 Task N"/"处理边界"等占位;每个改代码的步骤都有完整代码。✓

**3. Type consistency:**
- `BrowserTab`/`BrowserTabsState` 字段在 T1 定义,T2 `Partial<BrowserTab>`、T3 `newBrowserTab`/`patchBrowserTab` 用法一致。✓
- `WebviewEl` 在 T2 定义并导出,T3 `import { type WebviewEl }` 一致(含 `getTitle()`)。✓
- 回调签名 `onState(id, patch)`、`registerRef(id, el|null)` 在 T2 props 与 T3 实现一致。✓
- `normalizeUrl` 沿用既有签名(string→string)。✓
