# 产物摘要(置顶摘要)悬浮卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端顶栏加一个「产物摘要」按钮,点开弹悬浮卡,汇总本会话 agent 的输出(文件+服务)/子智能体/浏览器/来源,可点击直达。

**Architecture:** 纯前端、零后端改动。一个纯函数 `deriveArtifacts(items, workspace)` 从 transcript 派生结构化 `ArtifactSummary`;一个纯展示组件 `SummaryContent` 渲染四段(无 Radix,便于 jsdom 单测);一个薄壳 `SummaryPopover` 用既有 `ui/popover` 包裹并接 `window.wraith.openPath/openExternal`;`App.tsx` 顶栏工具条加按钮。

**Tech Stack:** TypeScript, React, @radix-ui/react-popover(经 `ui/popover` 封装), lucide-react, vitest + @testing-library/react(jsdom)。

## Global Constraints

- 纯前端,**不改 Java 后端、不重打 jar**;改动仅限 `desktop/`。
- 全部改动在**主 worktree** `~/Desktop/wraith/desktop`(桌面 dev 从此运行,renderer 改动走 HMR)。
- 中文 UI 文案;代码/路径/URL 保留原文。
- 复用既有 IPC:`window.wraith.openPath(path: string)`、`window.wraith.openExternal(url: string)`(均 `Promise<void>`)。
- 消费的 transcript 类型来自 `src/shared/transcriptReducer`:`Item` 联合、`ToolCard`、`TeamItem`、`AttachmentRef`;`diff` item 字段为 `{ type:'diff'; filePath; before; after }`(`before===''` = 新建)。
- 测试从 `desktop/` 目录跑:`npx vitest run <file>`、`npx tsc --noEmit`。
- 提交只 `git add` 本任务涉及文件,**不碰**仓库既有 WIP(README.md/demo 等)。

---

### Task 1: `deriveArtifacts` 纯函数 + 类型

**Files:**
- Create: `desktop/src/shared/artifactSummary.ts`
- Test: `desktop/test/artifactSummary.test.ts`

**Interfaces:**
- Consumes: `Item` from `src/shared/transcriptReducer`(已存在)。
- Produces:
  - `interface ArtifactFile { path: string; kind: 'created' | 'modified' }`
  - `interface ArtifactServer { url: string }`
  - `interface ArtifactSource { path: string; name: string; kind: string }`
  - `interface ArtifactSummary { files: ArtifactFile[]; servers: ArtifactServer[]; subagents: { total: number; done: number; roles: string[] } | null; browserUrl: string | null; sources: ArtifactSource[]; workspace: string | null; isEmpty: boolean }`
  - `function deriveArtifacts(items: readonly Item[], workspace: string | null): ArtifactSummary`

- [ ] **Step 1: 写失败测试**

Create `desktop/test/artifactSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveArtifacts } from '../src/shared/artifactSummary'
import type { Item } from '../src/shared/transcriptReducer'

function tool(name: string, argsJson: string, output: string): Item {
  return { type: 'tool', card: { callId: 'c-' + name, name, argsJson, output, done: true } }
}

describe('deriveArtifacts', () => {
  it('files: 按 path 去重,首个 diff 决定 新建/改动', () => {
    const items: Item[] = [
      { type: 'diff', filePath: 'README.md', before: '', after: '你好' },
      { type: 'diff', filePath: 'README.md', before: '你好', after: '你好2' },
      { type: 'diff', filePath: 'src/a.ts', before: 'old', after: 'new' },
    ]
    expect(deriveArtifacts(items, '/proj').files).toEqual([
      { path: 'README.md', kind: 'created' },
      { path: 'src/a.ts', kind: 'modified' },
    ])
  })

  it('servers: 从 execute_command 输出抽回环 URL,归一化 + 去重(含尾斜杠合并)', () => {
    const items: Item[] = [
      tool('execute_command', '{"command":"npm run dev"}', 'VITE ready at http://localhost:5173/\nlocalhost:5173'),
      tool('execute_command', '{"command":"x"}', 'listening on 127.0.0.1:3000'),
    ]
    expect(deriveArtifacts(items, null).servers).toEqual([
      { url: 'http://localhost:5173' },
      { url: 'http://127.0.0.1:3000' },
    ])
  })

  it('servers: 忽略非回环与无端口的提及', () => {
    const s = deriveArtifacts([tool('execute_command', '{}', 'see https://example.com and localhost without port')], null)
    expect(s.servers).toEqual([])
  })

  it('browser: 取浏览器工具最后一次 argsJson.url', () => {
    const items: Item[] = [
      tool('browser_navigate', '{"url":"https://a.com"}', ''),
      tool('mcp__chrome-devtools__navigate_page', '{"url":"https://b.com"}', ''),
    ]
    expect(deriveArtifacts(items, null).browserUrl).toBe('https://b.com')
  })

  it('subagents: 聚合 team 步数与角色;无 team → null', () => {
    expect(deriveArtifacts([], null).subagents).toBeNull()
    const team: Item = {
      type: 'team', teamId: 't1', goal: 'g',
      agents: [{ id: 'a1', role: 'coder' }, { id: 'a2', role: 'reviewer' }],
      steps: [
        { id: 's1', description: '', type: 'x', status: 'done' },
        { id: 's2', description: '', type: 'x', status: 'running' },
        { id: 's3', description: '', type: 'x', status: 'done' },
      ],
      parallelStepIds: [],
    }
    expect(deriveArtifacts([team], null).subagents).toEqual({ total: 3, done: 2, roles: ['coder', 'reviewer'] })
  })

  it('sources: 用户附件按 path 去重', () => {
    const items: Item[] = [
      { type: 'user', text: 'hi', attachments: [{ path: '/i/1.png', name: '1.png', kind: 'image' }] },
      { type: 'user', text: 'again', attachments: [{ path: '/i/1.png', name: '1.png', kind: 'image' }, { path: '/i/2.png', name: '2.png', kind: 'image' }] },
    ]
    expect(deriveArtifacts(items, '/proj').sources).toEqual([
      { path: '/i/1.png', name: '1.png', kind: 'image' },
      { path: '/i/2.png', name: '2.png', kind: 'image' },
    ])
  })

  it('isEmpty: 只有 workspace(无产物)→ true', () => {
    expect(deriveArtifacts([], '/proj').isEmpty).toBe(true)
    expect(deriveArtifacts([{ type: 'message', text: 'hi' }], '/proj').isEmpty).toBe(true)
  })

  it('isEmpty: 有任一产物 → false', () => {
    expect(deriveArtifacts([{ type: 'diff', filePath: 'a', before: '', after: 'x' }], null).isEmpty).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts`
Expected: FAIL —— `deriveArtifacts` 未定义 / 模块不存在。

- [ ] **Step 3: 实现 `deriveArtifacts`**

Create `desktop/src/shared/artifactSummary.ts`:

```ts
/**
 * artifactSummary — 纯 TS,从 transcript items 派生「本会话产物摘要」。
 * 无 React/Electron 依赖,可单测。四段:输出(文件+服务)/子智能体/浏览器/来源。
 */
import type { Item, ToolCard } from './transcriptReducer'

export interface ArtifactFile { path: string; kind: 'created' | 'modified' }
export interface ArtifactServer { url: string }
export interface ArtifactSource { path: string; name: string; kind: string }
export interface ArtifactSummary {
  files: ArtifactFile[]
  servers: ArtifactServer[]
  subagents: { total: number; done: number; roles: string[] } | null
  browserUrl: string | null
  sources: ArtifactSource[]
  workspace: string | null
  isEmpty: boolean
}

// 回环地址(本地 dev server / 预览):可选 http(s):// 前缀 + localhost|127.0.0.1 + 必须带端口。
const LOOPBACK_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s'"`]*)?/gi
// 任意 http(s) URL(浏览器活动从 output 兜底抽)。
const HTTP_RE = /https?:\/\/[^\s'"`]+/i

/** 归一化回环 URL:去尾部标点与尾斜杠、补 http:// 前缀,便于去重。 */
function normalizeLoopback(raw: string): string {
  let u = raw.trim().replace(/[),.;'"]+$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  return u
}

/** 浏览器工具的目标 URL:先 argsJson.url,再从 output 抽首个 http(s)。 */
function browserToolUrl(card: ToolCard): string | null {
  try {
    const args = JSON.parse(card.argsJson) as Record<string, unknown>
    if (typeof args['url'] === 'string' && args['url'].trim()) return args['url'].trim()
  } catch { /* 非 JSON,忽略 */ }
  const m = card.output ? card.output.match(HTTP_RE) : null
  return m ? m[0] : null
}

export function deriveArtifacts(items: readonly Item[], workspace: string | null): ArtifactSummary {
  const files = new Map<string, ArtifactFile>()
  const servers = new Map<string, ArtifactServer>()
  const sources = new Map<string, ArtifactSource>()
  const roles: string[] = []
  let subTotal = 0
  let subDone = 0
  let browserUrl: string | null = null

  for (const item of items) {
    switch (item.type) {
      case 'diff': {
        if (item.filePath && !files.has(item.filePath)) {
          files.set(item.filePath, { path: item.filePath, kind: item.before === '' ? 'created' : 'modified' })
        }
        break
      }
      case 'tool': {
        const card = item.card
        if (card.name === 'execute_command' && card.output) {
          for (const raw of card.output.match(LOOPBACK_RE) ?? []) {
            const url = normalizeLoopback(raw)
            if (!servers.has(url)) servers.set(url, { url })
          }
        }
        if (card.name.startsWith('browser') || card.name.startsWith('mcp__chrome-devtools__')) {
          const u = browserToolUrl(card)
          if (u) browserUrl = u
        }
        break
      }
      case 'team': {
        subTotal += item.steps.length
        subDone += item.steps.filter(s => s.status === 'done').length
        for (const a of item.agents) if (!roles.includes(a.role)) roles.push(a.role)
        break
      }
      case 'user': {
        for (const att of item.attachments ?? []) {
          if (!sources.has(att.path)) sources.set(att.path, { path: att.path, name: att.name, kind: att.kind })
        }
        break
      }
      default:
        break
    }
  }

  const subagents = (subTotal > 0 || roles.length > 0) ? { total: subTotal, done: subDone, roles } : null
  const fileList = [...files.values()]
  const serverList = [...servers.values()]
  const sourceList = [...sources.values()]
  const isEmpty =
    fileList.length === 0 && serverList.length === 0 && subagents === null &&
    browserUrl === null && sourceList.length === 0

  return { files: fileList, servers: serverList, subagents, browserUrl, sources: sourceList, workspace, isEmpty }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts`
Expected: PASS(8 个用例全绿)。

- [ ] **Step 5: 类型检查**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出(exit 0)。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/artifactSummary.ts desktop/test/artifactSummary.test.ts
git commit -m "feat(desktop): deriveArtifacts — 从 transcript 派生本会话产物摘要"
```

---

### Task 2: `SummaryContent` 纯展示组件

**Files:**
- Create: `desktop/src/renderer/components/SummaryPopover.tsx`(本任务只写并导出 `SummaryContent` + `resolveArtifactPath`;薄壳 `SummaryPopover` 默认导出在 Task 3 加)
- Test: `desktop/test/summaryPopover.test.tsx`

**Interfaces:**
- Consumes: `ArtifactSummary`(Task 1);`deriveArtifacts` 本任务不用。
- Produces:
  - `export function resolveArtifactPath(path: string, workspace: string | null): string` —— 相对路径按 workspace 拼成绝对,绝对路径原样。
  - `export function SummaryContent(props: { summary: ArtifactSummary; workspace: string | null; onOpenPath: (p: string) => void; onOpenExternal: (u: string) => void }): JSX.Element` —— 渲染四段 + 空态;不含 Radix,可直接 render 单测。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/summaryPopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SummaryContent, resolveArtifactPath } from '../src/renderer/components/SummaryPopover'
import type { ArtifactSummary } from '../src/shared/artifactSummary'

afterEach(() => cleanup())

const EMPTY: ArtifactSummary = { files: [], servers: [], subagents: null, browserUrl: null, sources: [], workspace: '/proj', isEmpty: true }

function full(): ArtifactSummary {
  return {
    files: [{ path: 'README.md', kind: 'created' }, { path: 'src/a.ts', kind: 'modified' }],
    servers: [{ url: 'http://localhost:5173' }],
    subagents: { total: 3, done: 2, roles: ['coder'] },
    browserUrl: 'https://b.com',
    sources: [{ path: '/i/1.png', name: '1.png', kind: 'image' }],
    workspace: '/proj',
    isEmpty: false,
  }
}

describe('resolveArtifactPath', () => {
  it('相对路径按 workspace 拼绝对', () => expect(resolveArtifactPath('src/a.ts', '/proj')).toBe('/proj/src/a.ts'))
  it('绝对路径原样', () => expect(resolveArtifactPath('/abs/x', '/proj')).toBe('/abs/x'))
  it('无 workspace 时相对路径原样', () => expect(resolveArtifactPath('a.ts', null)).toBe('a.ts'))
})

describe('SummaryContent', () => {
  it('空态显示文案', () => {
    render(<SummaryContent summary={EMPTY} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} />)
    expect(screen.getByTestId('summary-empty')).toBeTruthy()
  })

  it('渲染文件行并以解析后路径调用 onOpenPath', () => {
    const onOpenPath = vi.fn()
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={onOpenPath} onOpenExternal={vi.fn()} />)
    const files = screen.getAllByTestId('summary-file')
    expect(files).toHaveLength(2)
    fireEvent.click(files[1]!) // src/a.ts
    expect(onOpenPath).toHaveBeenCalledWith('/proj/src/a.ts')
  })

  it('服务/浏览器行调用 onOpenExternal', () => {
    const onOpenExternal = vi.fn()
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={onOpenExternal} />)
    fireEvent.click(screen.getByTestId('summary-server'))
    expect(onOpenExternal).toHaveBeenCalledWith('http://localhost:5173')
    fireEvent.click(screen.getByTestId('summary-browser'))
    expect(onOpenExternal).toHaveBeenCalledWith('https://b.com')
  })

  it('子智能体显示完成计数', () => {
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} />)
    expect(screen.getByTestId('summary-subagents').textContent).toContain('2/3 完成')
  })

  it('来源含附件与工作目录;>5 行时可展开', () => {
    const many: ArtifactSummary = { ...full(), files: [], servers: [], subagents: null, browserUrl: null,
      sources: Array.from({ length: 6 }, (_, i) => ({ path: `/i/${i}.png`, name: `${i}.png`, kind: 'image' })) }
    render(<SummaryContent summary={many} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} />)
    // 6 附件 + 1 工作目录 = 7 行 > 5,默认只显 5
    expect(screen.getAllByTestId('summary-source')).toHaveLength(5)
    fireEvent.click(screen.getByTestId('summary-sources-toggle'))
    expect(screen.getAllByTestId('summary-source')).toHaveLength(7)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/summaryPopover.test.tsx`
Expected: FAIL —— `SummaryContent`/`resolveArtifactPath` 未导出。

- [ ] **Step 3: 实现 `SummaryContent`**

Create `desktop/src/renderer/components/SummaryPopover.tsx`:

```tsx
import { useState } from 'react'
import { FileText, Folder, Globe, Image as ImageIcon, Users } from 'lucide-react'
import type { ArtifactSummary, ArtifactSource } from '../../shared/artifactSummary'

/** 相对路径按 workspace 拼绝对(供 openPath);绝对路径(/… 或 Windows 盘符)原样。 */
export function resolveArtifactPath(path: string, workspace: string | null): string {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return path
  return workspace ? workspace.replace(/\/+$/, '') + '/' + path : path
}

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg-muted hover:bg-surface/60'
const LABEL = 'mb-1 mt-2 text-3xs uppercase tracking-wider text-fg-subtle first:mt-0'
const SOURCES_FOLD = 5

function SourcesSection({ sources, workspace, onOpenPath }: {
  sources: ArtifactSource[]; workspace: string | null; onOpenPath: (p: string) => void
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const rows: { key: string; kind: 'img' | 'folder'; label: string; path: string }[] =
    sources.map(a => ({ key: 'a-' + a.path, kind: 'img' as const, label: a.name, path: a.path }))
  if (workspace) rows.push({ key: 'ws', kind: 'folder', label: workspace.split('/').filter(Boolean).pop() ?? workspace, path: workspace })
  if (rows.length === 0) return null
  const shown = expanded ? rows : rows.slice(0, SOURCES_FOLD)
  return (
    <>
      <div className={LABEL}>来源</div>
      {shown.map(r => (
        <button key={r.key} data-testid="summary-source" onClick={() => onOpenPath(r.path)} className={ROW}>
          {r.kind === 'img'
            ? <ImageIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            : <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
        </button>
      ))}
      {rows.length > SOURCES_FOLD && (
        <button data-testid="summary-sources-toggle" onClick={() => setExpanded(v => !v)}
          className="px-2 py-1 text-3xs text-fg-subtle hover:text-fg">
          {expanded ? '收起' : `查看全部 (${rows.length})`}
        </button>
      )}
    </>
  )
}

/** 悬浮卡正文(纯展示,无 Radix,便于单测)。四段:输出(文件+服务)/子智能体/浏览器/来源。 */
export function SummaryContent({ summary, workspace, onOpenPath, onOpenExternal }: {
  summary: ArtifactSummary
  workspace: string | null
  onOpenPath: (p: string) => void
  onOpenExternal: (u: string) => void
}): JSX.Element {
  if (summary.isEmpty) {
    return <div data-testid="summary-empty" className="px-2 py-3 text-xs text-fg-subtle">本会话暂无产物</div>
  }
  return (
    <div className="flex flex-col">
      {(summary.files.length > 0 || summary.servers.length > 0) && <div className={LABEL}>输出</div>}
      {summary.files.map(f => (
        <button key={'f-' + f.path} data-testid="summary-file"
          onClick={() => onOpenPath(resolveArtifactPath(f.path, workspace))} className={ROW}>
          <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{f.path}</span>
          <span className="shrink-0 text-3xs text-fg-subtle">{f.kind === 'created' ? '新建' : '改动'}</span>
        </button>
      ))}
      {summary.servers.map(sv => (
        <button key={'s-' + sv.url} data-testid="summary-server"
          onClick={() => onOpenExternal(sv.url)} className={ROW}>
          <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{sv.url}</span>
        </button>
      ))}

      {summary.subagents && (
        <>
          <div className={LABEL}>子智能体</div>
          <div data-testid="summary-subagents" className="flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
            <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span>
              {summary.subagents.done}/{summary.subagents.total} 完成
              {summary.subagents.roles.length > 0 ? ' · ' + summary.subagents.roles.join('、') : ''}
            </span>
          </div>
        </>
      )}

      {summary.browserUrl && (
        <>
          <div className={LABEL}>浏览器</div>
          <button data-testid="summary-browser" onClick={() => onOpenExternal(summary.browserUrl!)} className={ROW}>
            <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 flex-1 truncate">{summary.browserUrl}</span>
          </button>
        </>
      )}

      <SourcesSection sources={summary.sources} workspace={workspace} onOpenPath={onOpenPath} />
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/summaryPopover.test.tsx`
Expected: PASS(resolveArtifactPath 3 + SummaryContent 5 = 8 用例全绿)。

- [ ] **Step 5: 类型检查**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出(exit 0)。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SummaryPopover.tsx desktop/test/summaryPopover.test.tsx
git commit -m "feat(desktop): SummaryContent — 产物摘要悬浮卡正文(纯展示,四段)"
```

---

### Task 3: `SummaryPopover` 薄壳 + 顶栏接入

**Files:**
- Modify: `desktop/src/renderer/components/SummaryPopover.tsx`(在 Task 2 文件末尾加默认导出的薄壳)
- Modify: `desktop/src/renderer/App.tsx`(import + 顶栏工具条加按钮)

**Interfaces:**
- Consumes: `SummaryContent`、`deriveArtifacts`(Task 1)、`ui/popover`、`window.wraith.openPath/openExternal`、`state.items`(`Item[]`)、`state.workspace`。
- Produces: `export default function SummaryPopover(props: { items: readonly Item[]; workspace: string | null }): JSX.Element`。

- [ ] **Step 1: 实现薄壳 `SummaryPopover`(默认导出)**

在 `desktop/src/renderer/components/SummaryPopover.tsx` **顶部 import 区**补:

```tsx
import { useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { deriveArtifacts } from '../../shared/artifactSummary'
import type { Item } from '../../shared/transcriptReducer'
```

(注:把已有的 `import { useState } from 'react'` 合并为 `import { useMemo, useState } from 'react'`,不要重复 import。)

在**文件末尾**追加默认导出:

```tsx
/** 顶栏「产物摘要」按钮 + 悬浮卡薄壳:派生摘要 + Radix popover + 接 window.wraith。 */
export default function SummaryPopover({ items, workspace }: { items: readonly Item[]; workspace: string | null }): JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => deriveArtifacts(items, workspace), [items, workspace])
  const onOpenPath = (p: string): void => { void window.wraith.openPath(p).catch(() => {}) }
  const onOpenExternal = (u: string): void => { void window.wraith.openExternal(u).catch(() => {}) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="summary-toggle" title="产物摘要"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-fg/5 hover:text-fg">
          <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />产物
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
        <SummaryContent summary={summary} workspace={workspace} onOpenPath={onOpenPath} onOpenExternal={onOpenExternal} />
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: 接入 `App.tsx` 顶栏**

在 `desktop/src/renderer/App.tsx` 的 import 区(与其它组件 import 同处,例如 `RightDock` import 附近)加:

```tsx
import SummaryPopover from './components/SummaryPopover'
```

在顶栏工具条(`{!pv.showWelcome && (<div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">…` 内),把 `SummaryPopover` 放在「压缩」按钮**之前**(即 `data-testid="chat-compact"` 那个 `<button>` 前一行):

```tsx
                    <SummaryPopover items={state.items} workspace={state.workspace ?? null} />
                    <button
                      data-testid="chat-compact"
```

- [ ] **Step 3: 类型检查**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出(exit 0)。

- [ ] **Step 4: 跑相关测试 + 全量回归**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts test/summaryPopover.test.tsx`
Expected: PASS(16 用例)。

Run: `cd desktop && npx vitest run`
Expected: 全绿(此前基线 + 新增 2 文件;无回归)。

- [ ] **Step 5: 手动眼验(dev)**

启动/已运行桌面 dev(renderer HMR):发一轮会让 agent 写文件的话(如「生成 readme」),顶栏出现「产物」按钮;点开悬浮卡「输出」段列出该文件,标「新建/改动」,点击在默认程序打开;跑起 dev server 的命令后「输出」出现 localhost 行,点击外部浏览器打开;无产物时点开显示「本会话暂无产物」。
> 纯 renderer 改动,HMR 生效,**无需重启/重打 jar**。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SummaryPopover.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 顶栏产物摘要悬浮卡接入(SummaryPopover + App 工具条)"
```

---

## 自查(spec 覆盖)

- 四段(输出=文件+服务 / 子智能体 / 浏览器 / 来源):Task 1 派生 + Task 2 渲染 ✓
- 顶栏按钮弹 Radix 悬浮卡:Task 3 ✓
- 浏览器段=agent 工具活动(非手动 tab):Task 1 `browserToolUrl` 取最后一次 ✓
- 砍掉「+」手动添加:计划无该功能 ✓
- 「查看全部」就地展开(阈值 5):Task 2 `SourcesSection` ✓
- 空态文案:Task 2 `summary-empty` ✓
- open 动作走 `openPath`/`openExternal`:Task 3 薄壳 ✓
- 纯前端零后端:全程仅改 `desktop/` ✓
- 类型一致性:`deriveArtifacts`/`ArtifactSummary`/`SummaryContent`/`resolveArtifactPath`/`SummaryPopover` 命名跨任务一致 ✓
