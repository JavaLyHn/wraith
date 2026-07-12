# 命令面板 + 首页样式 + 移除字体选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①内嵌搜索升级为居中命令面板(搜索+命令+导航,真快捷键);②首页加 logo(闪光+悬停动效)+ 每次启动随机的示例卡(点卡直接发送);③设置移除「字体」项。

**Architecture:** 三个独立子特性。纯函数(commandPalette/welcomePrompts)先行 + vitest;组件与 App/Sidebar/Settings 集成后接。A、B 都改 App.tsx 故相继;C 独立可并行。

**Tech Stack:** React 18 + TypeScript + Tailwind;lucide-react;vitest(test/*.test.ts,import from ../src/renderer/...)。

## Global Constraints
- `desktop/` 下执行;`npm run typecheck` exit 0;`npm test` 基线 **646** 不降。
- 纯前端;不碰 config/密钥/日志;不动主进程。
- 快捷键做成真快捷键(全局 keydown,metaKey 组合);命令面板文件与首页/设置文件尽量隔离(见各任务)。
- push 需用户单独点头。

---

### Task A1: `lib/commandPalette.ts` 纯函数 + 单测

**Files:** Create `desktop/src/renderer/lib/commandPalette.ts`；Test `desktop/test/commandPalette.test.ts`

**Interfaces (Produces,A2/A3 依赖):** `PaletteItem`、`PaletteGroup`、`buildStaticItems(): PaletteItem[]`、`filterPalette(query, sessions, projects, staticItems): { groups: {title,items}[]; flat: PaletteItem[] }`。

- [ ] **Step 1: 写失败测试** `desktop/test/commandPalette.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildStaticItems, filterPalette } from '../src/renderer/lib/commandPalette'

const sessions = [{ id: 's1', title: '总结论文' }, { id: 's2', title: '打招呼' }]
const projects = [{ path: '/x/wraith', name: 'wraith' } as never]

describe('buildStaticItems', () => {
  it('2 命令 + 11 导航 = 13 项,含 new/settings', () => {
    const items = buildStaticItems()
    expect(items).toHaveLength(13)
    expect(items.filter(i => i.group === 'command').map(i => i.action)).toEqual(['new', 'settings'])
    expect(items.filter(i => i.group === 'nav')).toHaveLength(11)
    expect(items.find(i => i.action === 'new')?.hint).toBe('⌘N')
  })
})

describe('filterPalette', () => {
  const stat = buildStaticItems()
  it('空 query:全部分组,flat 顺序 会话→项目→命令→导航', () => {
    const { groups, flat } = filterPalette('', sessions, projects, stat)
    expect(groups.map(g => g.title)).toEqual(['会话', '项目', '命令', '导航'])
    expect(flat[0]!.action).toBe('session:s1')
    expect(flat.length).toBe(2 + 1 + 13)
  })
  it('query 过滤会话 + 命令(不区分大小写 contains)', () => {
    const { groups } = filterPalette('招呼', sessions, projects, stat)
    expect(groups.find(g => g.title === '会话')!.items.map(i => i.action)).toEqual(['session:s2'])
    expect(groups.find(g => g.title === '会话')).toBeTruthy()
  })
  it('空组不出现', () => {
    const { groups } = filterPalette('设置', sessions, projects, stat)
    expect(groups.some(g => g.title === '命令')).toBe(true)
    expect(groups.some(g => g.title === '会话')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run test/commandPalette.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 写实现** `desktop/src/renderer/lib/commandPalette.ts`

```ts
import { filterSidebar, type SessionFilterItem } from './sidebarSearch'
import type { ProjectView } from '../../shared/types'

export type PaletteGroup = 'session' | 'project' | 'command' | 'nav'
export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string        // 快捷键提示文案,如 '⌘N'
  action: string       // 'session:<id>' | 'project:<path>' | 'new' | 'settings' | 'view:<view>'
}

const NAV_ITEMS: { view: string; label: string }[] = [
  { view: 'plugins', label: '插件 (MCP)' },
  { view: 'automations', label: '自动化' },
  { view: 'im-gateway', label: 'IM 网关' },
  { view: 'providers', label: 'Provider 配置' },
  { view: 'skills', label: '技能' },
  { view: 'memory', label: '记忆' },
  { view: 'snapshots', label: '快照' },
  { view: 'tasks', label: '后台任务' },
  { view: 'policy', label: '策略' },
  { view: 'browser', label: '浏览器' },
  { view: 'rag', label: 'RAG' },
]

/** 固定命令 + 导航项(与查询无关)。 */
export function buildStaticItems(): PaletteItem[] {
  return [
    { id: 'cmd:new', group: 'command', label: '新对话', hint: '⌘N', action: 'new' },
    { id: 'cmd:settings', group: 'command', label: '设置', hint: '⌘,', action: 'settings' },
    ...NAV_ITEMS.map(n => ({ id: 'nav:' + n.view, group: 'nav' as PaletteGroup, label: n.label, action: 'view:' + n.view })),
  ]
}

const hit = (label: string, q: string): boolean => label.toLowerCase().includes(q)

/** 按 query 过滤 → 分组(非空才出)+ 扁平有序列表(供 ↑↓ 与 ⌘1–9)。 */
export function filterPalette(
  query: string,
  sessions: SessionFilterItem[],
  projects: ProjectView[],
  staticItems: PaletteItem[],
): { groups: { title: string; items: PaletteItem[] }[]; flat: PaletteItem[] } {
  const q = query.trim().toLowerCase()
  const fs = filterSidebar(sessions, projects, query)
  const sessionItems: PaletteItem[] = fs.sessions.map(s => ({
    id: 'session:' + s.id, group: 'session', label: s.title || '未命名', action: 'session:' + s.id,
  }))
  const projectItems: PaletteItem[] = fs.projects.map(p => ({
    id: 'project:' + p.path, group: 'project',
    label: p.name || p.path.split('/').filter(Boolean).pop() || p.path, action: 'project:' + p.path,
  }))
  const cmds = staticItems.filter(i => i.group === 'command' && (!q || hit(i.label, q)))
  const navs = staticItems.filter(i => i.group === 'nav' && (!q || hit(i.label, q)))
  const groups = [
    { title: '会话', items: sessionItems },
    { title: '项目', items: projectItems },
    { title: '命令', items: cmds },
    { title: '导航', items: navs },
  ].filter(g => g.items.length > 0)
  return { groups, flat: groups.flatMap(g => g.items) }
}
```

- [ ] **Step 4: 跑测试确认通过** `npx vitest run test/commandPalette.test.ts` → PASS。
- [ ] **Step 5: 类型检查** `npm run typecheck` → exit 0。
- [ ] **Step 6: 提交** `git add desktop/src/renderer/lib/commandPalette.ts desktop/test/commandPalette.test.ts && git commit -m "feat(desktop/palette): commandPalette 纯函数(命令/导航/过滤)+ 单测"`

---

### Task A2: `components/CommandPalette.tsx` 居中弹层

**Files:** Create `desktop/src/renderer/components/CommandPalette.tsx`

**Interfaces:**
- Consumes A1:`buildStaticItems / filterPalette / PaletteItem`(from `'../lib/commandPalette'`)、`SessionFilterItem`(from `'../lib/sidebarSearch'`)、`ProjectView`(from `'../../shared/types'`)。
- Produces:default export `CommandPalette` + `export interface PaletteActions { selectSession(id): void; activateProject(path): void; newConversation(): void; openSettings(): void; openView(view: string): void }`。props `{ open, onClose, sessions, projects, actions }`。

**说明:** 含 DOM/键盘,无单元测试;验收 = typecheck + 全量 646 保绿。自绘固定遮罩(不复用 Radix dialog)以完全掌控 ↑↓/⌘数字键(spec 提"可复用 dialog",此处改自绘键盘更可控,行为等价)。

- [ ] **Step 1: 写组件** `desktop/src/renderer/components/CommandPalette.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { buildStaticItems, filterPalette, type PaletteItem } from '../lib/commandPalette'
import type { SessionFilterItem } from '../lib/sidebarSearch'
import type { ProjectView } from '../../shared/types'

export interface PaletteActions {
  selectSession: (id: string) => void
  activateProject: (path: string) => void
  newConversation: () => void
  openSettings: () => void
  openView: (view: string) => void
}

/** 居中命令面板:搜索会话/项目 + 命令 + 导航。⌘K 开(由 App);面板内 ↑↓/回车/⌘1–9/Esc/点遮罩。 */
export default function CommandPalette(
  { open, onClose, sessions, projects, actions }:
  { open: boolean; onClose: () => void; sessions: SessionFilterItem[]; projects: ProjectView[]; actions: PaletteActions },
): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const staticItems = useMemo(() => buildStaticItems(), [])
  const { groups, flat } = useMemo(
    () => filterPalette(query, sessions, projects, staticItems),
    [query, sessions, projects, staticItems],
  )

  useEffect(() => { if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()) } }, [open])
  useEffect(() => { setActive(0) }, [query])

  const run = (item: PaletteItem): void => {
    const a = item.action
    if (a.startsWith('session:')) actions.selectSession(a.slice(8))
    else if (a.startsWith('project:')) actions.activateProject(a.slice(8))
    else if (a === 'new') actions.newConversation()
    else if (a === 'settings') actions.openSettings()
    else if (a.startsWith('view:')) actions.openView(a.slice(5))
    onClose()
  }

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(flat.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = flat[active]; if (it) run(it) }
    else if (e.metaKey && e.key >= '1' && e.key <= '9') { const idx = Number(e.key) - 1; if (idx < flat.length) { e.preventDefault(); run(flat[idx]!) } }
  }

  let counter = -1
  return (
    <div data-testid="command-palette" onMouseDown={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[12vh]">
      <div onMouseDown={e => e.stopPropagation()} onKeyDown={onKeyDown}
        className="flex max-h-[68vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
          <input ref={inputRef} data-testid="palette-input" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="搜索任务或运行命令"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {flat.length === 0 && <div className="px-4 py-6 text-center text-xs text-fg-subtle">无匹配结果</div>}
          {groups.map(g => (
            <div key={g.title} className="mb-1">
              <div className="px-4 py-1 text-2xs font-medium text-fg-subtle">{g.title}</div>
              {g.items.map(item => {
                counter += 1
                const idx = counter
                const sel = idx === active
                const numHint = idx < 9 ? '⌘' + (idx + 1) : ''
                return (
                  <button key={item.id} data-testid="palette-item"
                    onMouseEnter={() => setActive(idx)} onClick={() => run(item)}
                    className={'flex w-full items-center gap-2 px-4 py-2 text-left text-sm '
                      + (sel ? 'bg-accent/12 text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 text-2xs text-fg-subtle">{item.hint || numHint}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查** `npm run typecheck` → exit 0。
- [ ] **Step 3: 全量测试保持绿** `npm test` → 不低于 646,无新增失败。
- [ ] **Step 4: 提交** `git add desktop/src/renderer/components/CommandPalette.tsx && git commit -m "feat(desktop/palette): CommandPalette 居中弹层(分组结果 + 键盘导航)"`

---

### Task A3: App + Sidebar 接入命令面板(改 App.tsx + Sidebar.tsx)

**Files:** Modify `desktop/src/renderer/App.tsx`、`desktop/src/renderer/components/Sidebar.tsx`

**Interfaces:** Consumes A2(`CommandPalette` + `PaletteActions`)。

**说明:** 无单测;验收 = typecheck + 646 保绿 + 眼验。

- [ ] **Step 1: App.tsx —— import + 状态 + 全局快捷键**

顶部加 `import CommandPalette from './components/CommandPalette'`;若需要 `sessionDisplayName` 映射会话标题,确认已从 `'./lib/sessionView'` 导入(Sidebar 用过,App 若无则加)。

在状态区(`const [rightDockOpen, …]` 附近)加:
```tsx
  const [paletteOpen, setPaletteOpen] = useState(false)
```

在 effect 区加全局真快捷键(⌘K 开面板、⌘N 新对话、⌘, 设置):
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return
      if (e.key === 'k') { e.preventDefault(); setPaletteOpen(v => !v) }
      else if (e.key === 'n') { e.preventDefault(); handleNewConversation() }
      else if (e.key === ',') { e.preventDefault(); setView('settings') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNewConversation])
```

- [ ] **Step 2: App.tsx —— 渲染 CommandPalette + 给 Sidebar 传 onOpenSearch**

在顶层容器内(与 `<SidebarDock>` 同级,任意稳定位置,例如浮动展开按钮附近)渲染:
```tsx
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={sessions.map(s => ({ id: s.id, title: sessionDisplayName(s) }))}
        projects={projects}
        actions={{
          selectSession: handleSelectSession,
          activateProject: switchToProject,
          newConversation: handleNewConversation,
          openSettings: () => setView('settings'),
          openView: (v) => setView(v as typeof view),
        }}
      />
```
给 `<Sidebar … />` 增加一个 prop:`onOpenSearch={() => setPaletteOpen(true)}`。
(若 `sessionDisplayName(s)` 的签名不符,用 Sidebar 里构造 `sessionItems` 的同款映射;目标是 `{ id, title }[]`。)

- [ ] **Step 3: Sidebar.tsx —— 搜索图标改开面板 + 移除内嵌搜索**

- `SidebarProps` 增加 `onOpenSearch: () => void`;解构加 `onOpenSearch`。
- 把 `nav-search` 按钮的 `onClick={handleSearchActivate}` 改为 `onClick={onOpenSearch}`;保留该按钮(放大镜 + 「搜索」)。
- 移除内嵌搜索机制:`searchActive` / `searchQuery` 两个 `useState`;`inputRef` 的搜索聚焦 `useEffect`、外点关闭搜索 `useEffect`;`handleSearchActivate` / `handleKeyDown` / `handleSearchClear`;搜索输入框分支(`sidebar-search` input + `sidebar-search-clear`);`filtered = searchActive ? filterSidebar(...) : …` 与其在列表区的搜索结果渲染分支——改为始终渲染正常会话/项目列表(即原来 `!searchActive` 的那支)。
- 移除对 `filterSidebar` 的 import(Sidebar 不再用);保留 `Search` 图标 import(按钮仍用)。
- 不动:会话列表、项目、工具导航、折叠按钮等其余结构。

- [ ] **Step 4: 类型检查** `npm run typecheck` → exit 0。
- [ ] **Step 5: 全量测试保持绿** `npm test` → 不低于 646。(若有针对 Sidebar 内嵌搜索的既有测试因移除而失败,按"该行为已迁移到命令面板"更新/移除那些用例;`sidebarSearch`/`filterSidebar` 本身不删、其单测仍绿。)
- [ ] **Step 6: 提交** `git add desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx && git commit -m "feat(desktop/palette): 接入命令面板(⌘K/⌘N/⌘,真快捷键)+ 侧栏搜索改为开面板、移除内嵌搜索"`

**眼验:** ⌘K 开/关面板;输入过滤会话;↑↓ 选择、回车执行、⌘1–9 直达、Esc/点遮罩关;命令(新对话/设置)与导航(各面板)可跳;⌘N/⌘, 全局生效;侧栏放大镜按钮开面板、侧栏其余正常。

---

### Task B1: `lib/welcomePrompts.ts` 纯函数 + 单测

**Files:** Create `desktop/src/renderer/lib/welcomePrompts.ts`；Test `desktop/test/welcomePrompts.test.ts`

**Interfaces (Produces,B2 依赖):** `EXAMPLE_PROMPTS: string[]`、`pickExamplePrompts(pool, count, rng?): string[]`。

- [ ] **Step 1: 写失败测试** `desktop/test/welcomePrompts.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { EXAMPLE_PROMPTS, pickExamplePrompts } from '../src/renderer/lib/welcomePrompts'

describe('pickExamplePrompts', () => {
  it('取 count 条且无重复', () => {
    const r = pickExamplePrompts(EXAMPLE_PROMPTS, 4)
    expect(r).toHaveLength(4)
    expect(new Set(r).size).toBe(4)
    r.forEach(x => expect(EXAMPLE_PROMPTS).toContain(x))
  })
  it('count ≥ 池长 → 返回全量(打乱,不丢不重)', () => {
    const r = pickExamplePrompts(EXAMPLE_PROMPTS, 999)
    expect(r).toHaveLength(EXAMPLE_PROMPTS.length)
    expect(new Set(r)).toEqual(new Set(EXAMPLE_PROMPTS))
  })
  it('count=0 → 空', () => { expect(pickExamplePrompts(EXAMPLE_PROMPTS, 0)).toEqual([]) })
  it('注入 rng 决定性', () => {
    const pool = ['a', 'b', 'c']
    const r = pickExamplePrompts(pool, 2, () => 0) // 每步 j=0
    expect(r).toHaveLength(2)
    expect(new Set(r).size).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run test/welcomePrompts.test.ts` → FAIL。

- [ ] **Step 3: 写实现** `desktop/src/renderer/lib/welcomePrompts.ts`

```ts
export const EXAMPLE_PROMPTS: string[] = [
  '梳理这个项目的整体架构',
  '给这段代码补充单元测试',
  '解释这个报错并给出修复',
  '审查我最近的改动',
  '把这个函数重构得更清晰',
  '为这个模块写一段说明文档',
  '找出潜在的性能瓶颈',
  '帮我理清这个 bug 的复现路径',
  '把这个脚本改得更健壮',
  '总结这个目录下每个文件的职责',
]

/** 无重复随机取 count 条(count≥池长 → 返回打乱的全量;count≤0 → 空)。rng 可注入供测。 */
export function pickExamplePrompts(pool: string[], count: number, rng: () => number = Math.random): string[] {
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)))
}
```

- [ ] **Step 4: 跑测试确认通过** `npx vitest run test/welcomePrompts.test.ts` → PASS。
- [ ] **Step 5: 类型检查** `npm run typecheck` → exit 0。
- [ ] **Step 6: 提交** `git add desktop/src/renderer/lib/welcomePrompts.ts desktop/test/welcomePrompts.test.ts && git commit -m "feat(desktop/welcome): welcomePrompts 随机示例池 + 单测"`

---

### Task B2: 首页 logo/闪光/悬停 + 随机示例卡直发(WelcomeEmptyState + tokens.css + App)

**Files:** Modify `desktop/src/renderer/components/WelcomeEmptyState.tsx`、`desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/App.tsx`

**Interfaces:** Consumes B1(`EXAMPLE_PROMPTS / pickExamplePrompts`)。

**说明:** 无单测;验收 = typecheck + 646 保绿 + 眼验。**依赖 A3 已改过 App.tsx——B2 在其之后做(同文件相继,避免冲突)。**

- [ ] **Step 1: WelcomeEmptyState.tsx 整体重写**

```tsx
import type { ReactNode } from 'react'
import Logo from './Logo'

/** 首页空态:主题感知 logo(闪光+悬停动效)+ 随机示例卡(点卡直接发送)+ composer。 */
export default function WelcomeEmptyState(
  { examples, onPickExample, children }:
  { examples: string[]; onPickExample: (text: string) => void; children: ReactNode },
): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="welcome-logo mb-4"><Logo className="h-16 w-16 object-contain" /></div>
      <h1 className="mb-2 text-2xl font-semibold text-fg">今天做点什么?</h1>
      <p className="mb-6 text-sm text-fg-muted">Wraith 会读代码、跑命令、改文件——先说个目标</p>
      {examples.length > 0 && (
        <div className="mb-8 flex w-full max-w-2xl flex-wrap justify-center gap-2">
          {examples.map((ex) => (
            <button key={ex} data-testid="welcome-example" onClick={() => onPickExample(ex)}
              className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-fg-muted transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg hover:shadow-md">
              {ex}
            </button>
          ))}
        </div>
      )}
      <div className="w-full">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: tokens.css —— 首页 logo 闪光 + 悬停(仅 logo)**

在 `tokens.css` 末尾追加:
```css
/* 首页 logo:环境柔光 + 入场一次闪光扫;悬停增强辉光 + 再扫一次 + 轻放大(动效仅 logo) */
.welcome-logo { position: relative; display: inline-block; filter: drop-shadow(0 0 18px rgba(150,195,255,.28)); transition: filter .3s ease, transform .3s ease; }
.welcome-logo:hover { filter: drop-shadow(0 0 34px rgba(150,195,255,.6)); transform: scale(1.05); }
.welcome-logo::after {
  content: ''; position: absolute; inset: -8%; pointer-events: none; border-radius: 22%;
  background: linear-gradient(115deg, transparent 44%, rgba(255,255,255,.5) 49%, rgba(180,220,255,.55) 51%, transparent 57%);
  background-size: 240% 100%; opacity: 0;
  animation: welcomeShine 1200ms ease-out 400ms 1;
}
.welcome-logo:hover::after { animation: welcomeShine 900ms ease-out 1; }
@keyframes welcomeShine {
  0% { background-position: 150% 0; opacity: 0; }
  15% { opacity: 1; } 85% { opacity: 1; }
  100% { background-position: -60% 0; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .welcome-logo::after { animation: none; } }
```

- [ ] **Step 3: App.tsx —— 随机示例 + handleSubmit 支持覆盖文本 + 传参**

顶部加 `import { EXAMPLE_PROMPTS, pickExamplePrompts } from './lib/welcomePrompts'`。
状态区加(每次启动随机 4 条、会话内稳定):
```tsx
  const [examplePrompts] = useState(() => pickExamplePrompts(EXAMPLE_PROMPTS, 4))
```
把 `handleSubmit` 改为可接受覆盖文本(仅签名与首行,其余不变):
```tsx
  const handleSubmit = useCallback(async (override?: string) => {
    const text = (override ?? inputValue).trim()
    if (!text || state.turn === 'running') return
    // …(以下与现状完全一致:图片预检、setInputValue('')、dispatch、submitTurn 等)
  }, [inputValue, state.turn, state.model, attachments, pendingMode])
```
把 welcome 挂载改为:
```tsx
                    <WelcomeEmptyState examples={examplePrompts} onPickExample={(t) => void handleSubmit(t)}>{composer}</WelcomeEmptyState>
```
(Composer 仍以 `onSubmit={() => void handleSubmit()}` 无参调用——确认该调用点不传参、行为不变。)

- [ ] **Step 4: 类型检查** `npm run typecheck` → exit 0。
- [ ] **Step 5: 全量测试保持绿** `npm test` → 不低于 646。
- [ ] **Step 6: 提交** `git add desktop/src/renderer/components/WelcomeEmptyState.tsx desktop/src/renderer/styles/tokens.css desktop/src/renderer/App.tsx && git commit -m "feat(desktop/welcome): 首页 logo 闪光/悬停 + 随机示例卡直发"`

**眼验:** 首页 logo 有柔光、入场闪光扫、悬停增强+放大;示例卡每次启动不同、点卡直接发起对话;composer 正常。

---

### Task C1: 移除设置「字体」项(SettingsInterface)

**Files:** Modify `desktop/src/renderer/components/SettingsInterface.tsx`

**说明:** 独立、可与 A/B 并行;无单测,验收 = typecheck + 646 保绿。

- [ ] **Step 1: 移除「字体」块 + 清理**

删除「字体」整块(`<div>` 内含 `字体` 标签 + `FAMILY_OPTS.map` 的 `family-*` 按钮组,即当前约 58–66 行那个 `<div>…</div>`,连同其上方的空行)。删除 `FAMILY_OPTS` 常量声明。若 `FontFamily` 类型在文件内已无其他引用,从第 3 行 `import type { AccentKey, FontSize, FontFamily, ThemeMode } from '../settings/prefs'` 中移除 `FontFamily`。**保留「字号」块与其它一切不动;不改 `settings/prefs` 或 fontFamily 的应用逻辑。**

- [ ] **Step 2: 类型检查** `npm run typecheck` → exit 0(会暴露未用 import/常量,据此清干净)。
- [ ] **Step 3: 全量测试保持绿** `npm test` → 不低于 646。(若既有测试断言 `family-*` 按钮存在,更新/移除那些用例——该 UI 已按需求移除。)
- [ ] **Step 4: 提交** `git add desktop/src/renderer/components/SettingsInterface.tsx && git commit -m "feat(desktop/settings): 移除「字体」选择(保留字号)"`

**眼验:** 设置 → 界面:无「字体」项;「主题/强调色/字号」正常;切字号仍生效。

---

## 执行顺序 / 并行
- 纯函数先行:A1、B1(可并行)。
- A2 依赖 A1;A3 依赖 A2(改 App+Sidebar)。B2 依赖 B1,且**改 App.tsx,须在 A3 之后**(相继,避免同文件冲突)。
- **C1 全程独立**,可与任意任务并行。
- 建议序:A1‖B1‖C1 → A2 → A3 → B2。

## Self-Review
**Spec coverage:** A(commandPalette+CommandPalette+App/Sidebar 接入+真快捷键)→A1/A2/A3;B(logo 闪光/悬停+随机卡直发)→B1/B2;C(移除字体)→C1。✓
**Placeholder scan:** 新文件全代码;A3/C1 的"移除"类步骤给了明确锚点与范围(非占位)。✓
**Type consistency:** `PaletteItem`/`buildStaticItems`/`filterPalette`(A1)→A2/A3 一致;`PaletteActions` A2 定义、A3 传入一致;`pickExamplePrompts`/`EXAMPLE_PROMPTS`(B1)→B2 一致;`handleSubmit(override?)` 首行改、deps 不变。✓
