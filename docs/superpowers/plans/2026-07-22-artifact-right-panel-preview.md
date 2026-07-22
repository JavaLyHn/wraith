# 产物 → 右侧完整预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话里的产物卡和顶栏「产物」摘要里的文件点一下,右半屏 RightDock 新增的「预览」pane 渲染该文件完整内容(md 富文本、其它等宽)。

**Architecture:** 纯前端、零后端。复用 transcript `diff` 事件已带的 `after` 全文作为内容源。`deriveArtifacts` 的 `ArtifactFile` 加 `content`;新组件 `ArtifactPreview` 渲染;`RightDock` 加 `'artifact'` pane;`App` 加 `previewArtifact` 状态 + `openArtifact`;两个入口(内联 `DiffCard` 加按钮、`SummaryPopover` 文件行改回调)调 `openArtifact`。

**Tech Stack:** TypeScript, React, react-markdown + remark-gfm(复用 `AgentMessage` 的 `MARKDOWN_COMPONENTS`), lucide-react, @radix-ui/react-popover(既有), vitest + @testing-library/react(jsdom)。

## Global Constraints

- 纯前端,**不改 Java、不重打 jar**;改动仅限 `desktop/`。全部在**主 worktree** `~/Desktop/wraith/desktop`(renderer 走 HMR)。
- 中文 UI 文案/注释;代码/路径/URL 原文。
- 内容源 = transcript `diff` 事件的 `after`(agent 最后写入内容),**不读实时磁盘**。
- 代码文件 v1 等宽纯文本、**无**语法高亮。
- 只**产物文件**走右侧预览;摘要的 服务 URL / 浏览器 / 来源附件 维持现状(`openExternal`/`openPath` 不变)。
- 复用既有:`ArtifactSummary`/`deriveArtifacts`(`src/shared/artifactSummary.ts`)、`SummaryContent`/`SummaryPopover`(`src/renderer/components/SummaryPopover.tsx`)、`MARKDOWN_COMPONENTS`(`src/renderer/components/AgentMessage.tsx`)、`baseName`(`src/renderer/lib/paths.ts`)、`RightDock`/`RightDockPane`(`src/renderer/components/RightDock.tsx`)。
- 测试从 `desktop/` 跑:`npx vitest run <file>`、`npx tsc --noEmit`。
- 提交只 `git add` 本任务文件,**不碰**仓库既有 WIP(README.md/demo/progress.md/.superpowers 等)。

---

### Task 1: `ArtifactFile` 增 `content` 字段

**Files:**
- Modify: `desktop/src/shared/artifactSummary.ts`
- Modify: `desktop/test/artifactSummary.test.ts`
- Modify: `desktop/test/summaryPopover.test.tsx`(修 `full()` fixture,补 `content`,否则 tsc 报缺字段)

**Interfaces:**
- Produces: `ArtifactFile = { path: string; kind: 'created' | 'modified'; content: string }`,`content` = 该路径**最后一次** `diff` 的 `after`(kind 仍取**首个** diff)。

- [ ] **Step 1: 改测试(先让它反映新契约)**

在 `desktop/test/artifactSummary.test.ts` 里,把名为 `'files: 按 path 去重,首个 diff 决定 新建/改动'` 的用例整体替换为:

```ts
  it('files: 按 path 去重,首个 diff 定 kind、content 取最后一次 after', () => {
    const items: Item[] = [
      { type: 'diff', filePath: 'README.md', before: '', after: '你好' },
      { type: 'diff', filePath: 'README.md', before: '你好', after: '你好2' },
      { type: 'diff', filePath: 'src/a.ts', before: 'old', after: 'new' },
    ]
    expect(deriveArtifacts(items, '/proj').files).toEqual([
      { path: 'README.md', kind: 'created', content: '你好2' },
      { path: 'src/a.ts', kind: 'modified', content: 'new' },
    ])
  })
```

在 `desktop/test/summaryPopover.test.tsx` 的 `full()` 里,把 `files` 那两项补上 `content`:

```ts
    files: [{ path: 'README.md', kind: 'created', content: '你好' }, { path: 'src/a.ts', kind: 'modified', content: 'x=1' }],
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts`
Expected: FAIL —— `files` 结果缺 `content`,toEqual 不匹配。

- [ ] **Step 3: 实现**

在 `desktop/src/shared/artifactSummary.ts`:

(a) 改接口:
```ts
export interface ArtifactFile { path: string; kind: 'created' | 'modified'; content: string }
```

(b) 改 `deriveArtifacts` 里的 `case 'diff'` 分支为:
```ts
      case 'diff': {
        if (item.filePath) {
          const existing = files.get(item.filePath)
          // kind 取首个 diff;content 取最后一次 after(展示最新产物)。Map.set 已存在的 key 不改插入顺序。
          files.set(item.filePath, existing
            ? { ...existing, content: item.after }
            : { path: item.filePath, kind: item.before === '' ? 'created' : 'modified', content: item.after })
        }
        break
      }
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts test/summaryPopover.test.tsx`
Expected: PASS(artifactSummary 12、summaryPopover 现有全绿)。
Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/artifactSummary.ts desktop/test/artifactSummary.test.ts desktop/test/summaryPopover.test.tsx
git commit -m "feat(desktop): ArtifactFile 增 content 字段(供右侧完整预览)"
```

---

### Task 2: `ArtifactPreview` 渲染组件

**Files:**
- Create: `desktop/src/renderer/components/ArtifactPreview.tsx`
- Test: `desktop/test/artifactPreview.test.tsx`

**Interfaces:**
- Produces: `export default function ArtifactPreview(props: { filePath: string; content: string }): JSX.Element`。
- Consumes: `MARKDOWN_COMPONENTS`(`./AgentMessage`)、`baseName`(`../lib/paths`)、`react-markdown`、`remark-gfm`。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/artifactPreview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ArtifactPreview from '../src/renderer/components/ArtifactPreview'

afterEach(() => cleanup())

describe('ArtifactPreview', () => {
  it('.md → 渲染 markdown(标题不带 #),容器带 agent-markdown', () => {
    render(<ArtifactPreview filePath="README.md" content={'# 标题\n\n正文'} />)
    const md = screen.getByTestId('artifact-markdown')
    expect(md.className).toContain('agent-markdown')
    expect(md.querySelector('h1')?.textContent).toBe('标题')
    expect(md.textContent).not.toContain('#')
  })

  it('非 md(.ts)→ 原文进 <pre>,不被 markdown 解释', () => {
    const src = 'const x = 1 // # not a heading'
    render(<ArtifactPreview filePath="src/a.ts" content={src} />)
    const code = screen.getByTestId('artifact-code')
    expect(code.tagName).toBe('PRE')
    expect(code.textContent).toBe(src)
    expect(screen.queryByTestId('artifact-markdown')).toBeNull()
  })

  it('空 content → 占位', () => {
    render(<ArtifactPreview filePath="empty.md" content="" />)
    expect(screen.getByTestId('artifact-empty')).toBeTruthy()
  })

  it('顶部显示文件名 baseName', () => {
    render(<ArtifactPreview filePath="/a/b/README.md" content="x" />)
    expect(screen.getByText('README.md')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/artifactPreview.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

Create `desktop/src/renderer/components/ArtifactPreview.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_COMPONENTS } from './AgentMessage'
import { baseName } from '../lib/paths'

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * 右侧「预览」pane 正文:渲染产物完整内容(纯展示,可单测)。
 * .md/.markdown → react-markdown 富文本(复用 AgentMessage 的 MARKDOWN_COMPONENTS + .agent-markdown);
 * 其它扩展名 → 等宽 <pre>(v1 无语法高亮);空内容 → 占位。内容为 agent 最后写入的原文,不 stripDsml。
 */
export default function ArtifactPreview({ filePath, content }: { filePath: string; content: string }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold text-fg">
        <span className="truncate font-mono" title={filePath}>{baseName(filePath)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {content === ''
          ? <div data-testid="artifact-empty" className="text-xs text-fg-subtle">(空文件)</div>
          : isMarkdown(filePath)
            ? (
              <div data-testid="artifact-markdown" className="agent-markdown text-sm leading-7 text-fg">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
              </div>
            )
            : <pre data-testid="artifact-code" className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{content}</pre>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `cd desktop && npx vitest run test/artifactPreview.test.tsx`
Expected: PASS(4 用例)。
Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/ArtifactPreview.tsx desktop/test/artifactPreview.test.tsx
git commit -m "feat(desktop): ArtifactPreview — 产物完整内容渲染(md 富文本/其它等宽)"
```

---

### Task 3: RightDock「预览」pane + App 预览状态 + 摘要入口

**Files:**
- Modify: `desktop/src/renderer/components/RightDock.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/SummaryPopover.tsx`
- Modify: `desktop/test/summaryPopover.test.tsx`

**Interfaces:**
- Consumes: `ArtifactPreview`(Task 2)、`ArtifactFile.content`(Task 1)。
- Produces:
  - `RightDockPane` 增 `'artifact'`;`RightDock` 新增 prop `artifact: { filePath: string; content: string } | null`。
  - `App` 内 `openArtifact(filePath: string, content: string): void`。
  - `SummaryContent`/`SummaryPopover` 新增 prop `onOpenArtifact: (filePath: string, content: string) => void`。
  - **移除** `resolveArtifactPath`。

- [ ] **Step 1: RightDock 加 'artifact' pane**

在 `desktop/src/renderer/components/RightDock.tsx`:

(a) import 处加:
```tsx
import ArtifactPreview from './ArtifactPreview'
```

(b) 类型:
```tsx
export type RightDockPane = 'browser' | 'terminal' | 'context' | 'artifact'
```

(c) props 解构与类型加 `artifact`:把函数签名的解构 `{ open, cwd, pane, onPaneChange, onClose, context, status, onCompact, compactDisabled }` 改为加上 `artifact`,并在其类型字面量里加一行:
```tsx
  artifact: { filePath: string; content: string } | null
```

(d) 分段器加一段(在 `{seg('context', '上下文')}` 之后):
```tsx
          {seg('artifact', '预览')}
```

(e) 面板区加一块(在 context 那个 `<div>` 之后、`</div>` 收尾前):
```tsx
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'artifact' ? '' : 'hidden')}>
            {artifact
              ? <ArtifactPreview filePath={artifact.filePath} content={artifact.content} />
              : <div className="p-3 text-xs text-fg-subtle">点击产物文件在此预览完整内容。</div>}
          </div>
```

- [ ] **Step 2: App 加预览状态 + openArtifact + 接线**

在 `desktop/src/renderer/App.tsx`:

(a) 在 `const [rightDockPane, setRightDockPane] = useState<RightDockPane>('browser')`(约 L175)之后加:
```tsx
  const [previewArtifact, setPreviewArtifact] = useState<{ filePath: string; content: string } | null>(null)
  const openArtifact = useCallback((filePath: string, content: string): void => {
    setPreviewArtifact({ filePath, content })
    setRightDockPane('artifact')
    setRightDockOpen(true)
  }, [])
```

(b) 给 `<RightDock ... />`(约 L1097)加一个 prop:
```tsx
        artifact={previewArtifact}
```

(c) 给 `<SummaryPopover ... />`(顶栏工具条里,约 L1051)加 prop:
```tsx
                    <SummaryPopover items={state.items} workspace={state.workspace ?? null} onOpenArtifact={openArtifact} />
```

- [ ] **Step 3: SummaryPopover 文件行改走 onOpenArtifact + 移除 resolveArtifactPath**

在 `desktop/src/renderer/components/SummaryPopover.tsx`:

(a) **删除** `resolveArtifactPath` 整个导出函数(第 8-12 行那段 `/** 相对路径… */ export function resolveArtifactPath ... }`)。

(b) `SummaryContent` 的 props 加 `onOpenArtifact`,签名改为:
```tsx
export function SummaryContent({ summary, workspace, onOpenPath, onOpenExternal, onOpenArtifact }: {
  summary: ArtifactSummary
  workspace: string | null
  onOpenPath: (p: string) => void
  onOpenExternal: (u: string) => void
  onOpenArtifact: (filePath: string, content: string) => void
}): JSX.Element {
```

(c) 文件行 onClick 从 `onClick={() => onOpenPath(resolveArtifactPath(f.path, workspace))}` 改为:
```tsx
          onClick={() => onOpenArtifact(f.path, f.content)}
```
(该 `<button data-testid="summary-file" ...>` 其余不变。)

(d) 默认导出 `SummaryPopover` 加 prop 并透传:签名改为
```tsx
export default function SummaryPopover({ items, workspace, onOpenArtifact }: { items: readonly Item[]; workspace: string | null; onOpenArtifact: (filePath: string, content: string) => void }): JSX.Element {
```
并把渲染处 `<SummaryContent .../>` 加上 `onOpenArtifact={onOpenArtifact}`:
```tsx
        <SummaryContent summary={summary} workspace={workspace} onOpenPath={onOpenPath} onOpenExternal={onOpenExternal} onOpenArtifact={onOpenArtifact} />
```

- [ ] **Step 4: 改 summaryPopover.test.tsx**

在 `desktop/test/summaryPopover.test.tsx`:

(a) **删除** 顶部 import 里的 `resolveArtifactPath`,以及整个 `describe('resolveArtifactPath', ...)` 块。import 行改为:
```tsx
import { SummaryContent } from '../src/renderer/components/SummaryPopover'
```

(b) 所有 `render(<SummaryContent ... />)` 调用补上 `onOpenArtifact={vi.fn()}` prop(否则 tsc 报缺 prop)。对需要断言的用例传具名 mock。

(c) 把原「渲染文件行并以解析后路径调用 onOpenPath」用例替换为:
```tsx
  it('点文件行调用 onOpenArtifact(path, content)', () => {
    const onOpenArtifact = vi.fn()
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} onOpenArtifact={onOpenArtifact} />)
    const files = screen.getAllByTestId('summary-file')
    expect(files).toHaveLength(2)
    fireEvent.click(files[1]!) // src/a.ts
    expect(onOpenArtifact).toHaveBeenCalledWith('src/a.ts', 'x=1')
  })
```
（`full()` 的 `src/a.ts` content 在 Task 1 已设为 `'x=1'`。）

- [ ] **Step 5: 类型检查 + 测试**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出(确认无残留 `resolveArtifactPath` 引用、RightDock/SummaryPopover 新 prop 都接上)。
Run: `cd desktop && npx vitest run test/summaryPopover.test.tsx`
Expected: PASS(移除 resolveArtifactPath 3 用例;SummaryContent 用例含新文件行断言)。
Run: `cd desktop && npx vitest run`
Expected: 全量全绿,无回归。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/App.tsx desktop/src/renderer/components/SummaryPopover.tsx desktop/test/summaryPopover.test.tsx
git commit -m "feat(desktop): RightDock 预览 pane + 摘要文件点击在右侧渲染完整内容"
```

---

### Task 4: 内联 DiffCard「在右侧打开」入口

**Files:**
- Modify: `desktop/src/renderer/components/DiffCard.tsx`
- Modify: `desktop/src/renderer/components/Transcript.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/diffCard.test.tsx`

**Interfaces:**
- Consumes: `App` 的 `openArtifact`(Task 3)。
- Produces: `DiffCard` 新增可选 prop `onOpenArtifact?: (filePath: string, content: string) => void`;`Transcript` 新增可选 prop `onOpenArtifact?: (filePath: string, content: string) => void` 并透传给 `DiffCard`。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/diffCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DiffCard from '../src/renderer/components/DiffCard'

afterEach(() => cleanup())

describe('DiffCard 右侧入口', () => {
  it('点「在右侧打开」调 onOpenArtifact(filePath, after),且不折叠', () => {
    const onOpen = vi.fn()
    render(<DiffCard filePath="README.md" before="" after="你好" onOpenArtifact={onOpen} />)
    const toggle = screen.getByTestId('diff-card-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('diff-card-open'))
    expect(onOpen).toHaveBeenCalledWith('README.md', '你好')
    expect(toggle.getAttribute('aria-expanded')).toBe('true') // 打开右侧不影响展开态
  })

  it('无 onOpenArtifact 时不渲染右侧入口', () => {
    render(<DiffCard filePath="a.md" before="" after="x" />)
    expect(screen.queryByTestId('diff-card-open')).toBeNull()
  })

  it('点切换按钮仍能折叠/展开', () => {
    render(<DiffCard filePath="a.md" before="" after="x" onOpenArtifact={vi.fn()} />)
    const toggle = screen.getByTestId('diff-card-toggle')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/diffCard.test.tsx`
Expected: FAIL —— `diff-card-open` 不存在 / `onOpenArtifact` 非法 prop。

- [ ] **Step 3: 改 DiffCard**

把 `desktop/src/renderer/components/DiffCard.tsx` 整个文件替换为:

```tsx
import { useState } from 'react'
import { PanelRight } from 'lucide-react'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'

interface DiffCardProps {
  filePath: string
  before: string
  after: string
  /** 提供时,卡片头部出现「在右侧打开」按钮,点击把完整内容开到右侧预览 pane。 */
  onOpenArtifact?: (filePath: string, content: string) => void
}

/** write_file 事后 diff 卡片:折叠时卸载 DiffView(控内存)。可选「在右侧打开」入口渲染完整内容。 */
export default function DiffCard({ filePath, before, after, onOpenArtifact }: DiffCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null)

  return (
    <div data-testid="diff-card" className="my-1 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-xs">
        <button
          data-testid="diff-card-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          <span className="truncate font-mono font-semibold text-fg" title={filePath}>📝 {baseName(filePath)}</span>
          {stats && <span className="shrink-0 text-ok">+{stats.added}</span>}
          {stats && <span className="shrink-0 text-danger">-{stats.removed}</span>}
        </button>
        {onOpenArtifact && (
          <button
            data-testid="diff-card-open"
            title="在右侧打开完整内容"
            onClick={() => onOpenArtifact(filePath, after)}
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-fg/10 hover:text-fg"
          >
            <PanelRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          data-testid="diff-card-toggle-label"
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-fg-subtle hover:text-fg"
        >{collapsed ? '展开' : '收起'}</button>
      </div>
      {!collapsed && (
        <DiffView
          filePath={filePath}
          before={before}
          after={after}
          onStats={(added, removed) => setStats({ added, removed })}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Transcript 透传 + App 接线**

(a) `desktop/src/renderer/components/Transcript.tsx`:`TranscriptProps` 加一行:
```tsx
  /** 提供时,DiffCard 显示「在右侧打开」入口。 */
  onOpenArtifact?: (filePath: string, content: string) => void
```
函数解构参数加 `onOpenArtifact`:把 `export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage, onPlanReview, mode }: TranscriptProps)` 改为在 `mode` 后加 `, onOpenArtifact`。
渲染 DiffCard 处(约 L102)改为:
```tsx
          return <DiffCard key={`diff-${originalIdx}`} filePath={item.filePath} before={item.before} after={item.after} onOpenArtifact={onOpenArtifact} />
```

(b) `desktop/src/renderer/App.tsx`:给 `<Transcript ... />`(约 L1074)加一个 prop(放在 `mode={pendingMode}` 那行之后):
```tsx
                      onOpenArtifact={openArtifact}
```

- [ ] **Step 5: 类型检查 + 测试 + 全量回归**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。
Run: `cd desktop && npx vitest run test/diffCard.test.tsx`
Expected: PASS(3 用例)。
Run: `cd desktop && npx vitest run`
Expected: 全量全绿,无回归。

- [ ] **Step 6: 手动眼验(dev)**

renderer HMR 生效、无需重启/重打 jar。发「生成 readme」→ 对话里 diff 卡右上出现「在右侧打开」按钮,点它右侧「预览」pane 渲染出 md 富文本;顶栏「产物」摘要点该文件同样在右侧打开;非 md 文件等宽显示。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/DiffCard.tsx desktop/src/renderer/components/Transcript.tsx desktop/src/renderer/App.tsx desktop/test/diffCard.test.tsx
git commit -m "feat(desktop): 内联 diff 卡加「在右侧打开」入口渲染完整内容"
```

---

## 自查(spec 覆盖)

- 内容源 = transcript `after`,不读盘:Task 1 content 字段 + Task 4 DiffCard 传 `after` ✓
- 右侧渲染完整内容(md 富文本/其它等宽):Task 2 ArtifactPreview ✓
- RightDock 新增「预览」pane:Task 3 ✓
- 两入口(内联卡 + 摘要文件):Task 4(DiffCard)+ Task 3(SummaryPopover 文件行)✓
- 内联 diff 卡保留、仅加入口:Task 4 DiffCard 展开/收起逻辑不变 ✓
- 移除死代码 resolveArtifactPath(+其测试):Task 3 ✓
- 服务/浏览器/来源维持现状:未改其 onClick ✓
- 代码无高亮 / 只产物文件走右侧:Task 2 等宽 + 仅文件行改 ✓
- 类型/命名跨任务一致:`ArtifactFile.content`、`openArtifact`、`onOpenArtifact`、`artifact` prop、`'artifact'` pane 一致 ✓
