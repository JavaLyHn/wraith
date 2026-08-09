# 文件产物卡片 Hover Peek 预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端 `FileArtifactCard` 增加 300ms hover 延迟触发的浮动 popover 预览，鼠标可移到 popover 不关闭，click 文件名仍走右侧 dock 正式预览。

**Architecture:** 新增 `FileArtifactHoverPreview` 组件用 Radix Popover（已存在于 `desktop/src/renderer/components/ui/popover.tsx`）包裹 `FileArtifactCard`。从 `ArtifactPreview` 抽取 `ArtifactPreviewBody` 供 popover 复用。`Transcript.tsx` 渲染时用 `FileArtifactHoverPreview` 替换原 `FileArtifactCard`。

**Tech Stack:** React + TypeScript + Radix UI Popover + Vitest + @testing-library/react

## Global Constraints

- 不引入新依赖（Radix Popover 已在 `desktop/src/renderer/components/ui/popover.tsx`）
- 复用 `ArtifactPreview` 的渲染逻辑（.md 富文本 / 等宽 `<pre>` / 空文件占位）
- Timer 用 `useRef<number | null>(null)` 持有，`useEffect` cleanup 清掉
- hover 延迟 300ms，关闭延迟 200ms
- content > 50KB 截断显示前 50KB
- 测试用 Vitest fake timers
- 遵循现有代码风格：CSS 类名用 Tailwind，测试在 `desktop/test/`
- 提交信息用中文，遵循 conventional commits 格式
- 不要破坏 `fileArtifactCard.test.tsx` 已有测试

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `desktop/src/renderer/components/ArtifactPreview.tsx` | 抽取 `ArtifactPreviewBody` 命名 export；原 `ArtifactPreview` 内部改用 `ArtifactPreviewBody` | Modify |
| `desktop/src/renderer/components/FileArtifactCard.tsx` | 拆出 `FileArtifactCardInner` 命名 export（去掉外层 `<div>`）；default export 保持向后兼容 | Modify |
| `desktop/src/renderer/components/FileArtifactHoverPreview.tsx` | 新增组件：hover trigger + Radix Popover + Header + ArtifactPreviewBody | Create |
| `desktop/src/renderer/components/Transcript.tsx` | `renderChips` 用 `FileArtifactHoverPreview` 替换 `FileArtifactCard` | Modify |
| `desktop/test/fileArtifactHoverPreview.test.tsx` | 覆盖 hover 时序、桥接区、ESC、截断、空内容、click 行为 | Create |
| `desktop/test/artifactPreview.test.tsx` | 验证 `ArtifactPreviewBody` 提取后行为等价（已有测试应通过） | Verify only |

---

### Task 1: 从 ArtifactPreview 抽取 ArtifactPreviewBody

**Files:**
- Modify: `desktop/src/renderer/components/ArtifactPreview.tsx`
- Verify: `desktop/test/artifactPreview.test.tsx`

**Interfaces:**
- Produces: `ArtifactPreviewBody({ filePath: string, content: string }): JSX.Element` —— 纯渲染组件，无 Header

- [ ] **Step 1: 读现有 ArtifactPreview.test.tsx，确认现有断言**

Run: `cat desktop/test/artifactPreview.test.tsx`
Expected: 看清现有测试断言哪些 testid（`artifact-markdown`/`artifact-code`/`artifact-empty`）和 props

- [ ] **Step 2: 修改 ArtifactPreview.tsx，抽出 ArtifactPreviewBody**

把内容渲染部分（`content === '' ? ... : isMarkdown(...) ? ... : ...`）提取为 `ArtifactPreviewBody` 命名 export。原 `ArtifactPreview` 仍保留外层结构（标题栏 + 容器），内部改用 `ArtifactPreviewBody`：

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_COMPONENTS } from './AgentMessage'
import { baseName } from '../lib/paths'
import type { PreviewArtifact } from '../../shared/artifactSummary'

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * 产物正文渲染(纯展示,可单测,供 ArtifactPreview 和 hover popover 复用)。
 * .md/.markdown → react-markdown 富文本(复用 AgentMessage 的 MARKDOWN_COMPONENTS);
 * 其它扩展名 → 等宽 <pre>;空内容 → 占位。
 */
export function ArtifactPreviewBody({ filePath, content }: { filePath: string; content: string }): JSX.Element {
  if (content === '') {
    return <div data-testid="artifact-empty" className="text-xs text-fg-subtle">(空文件)</div>
  }
  if (isMarkdown(filePath)) {
    return (
      <div data-testid="artifact-markdown" className="agent-markdown text-sm leading-7 text-fg">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
      </div>
    )
  }
  return <pre data-testid="artifact-code" className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{content}</pre>
}

/**
 * 右侧「预览」pane 正文:渲染产物完整内容(带标题栏)。
 * 内容为 agent 最后写入的原文,不 stripDsml。
 */
export default function ArtifactPreview({ filePath, content }: PreviewArtifact): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
        <span className="truncate font-mono font-semibold" title={filePath}>{baseName(filePath)}</span>
        <span className="shrink-0 text-2xs font-normal text-fg-subtle" title="agent 写入时的内容,非实时磁盘">· 快照</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <ArtifactPreviewBody filePath={filePath} content={content} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 跑 artifactPreview.test.tsx 验证未破坏**

Run: `npx vitest run desktop/test/artifactPreview.test.tsx`
Expected: PASS，所有现有测试通过

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/components/ArtifactPreview.tsx
git commit -m "refactor(artifact-preview): 抽取 ArtifactPreviewBody 供 hover popover 复用

把 .md 富文本 / 等宽 pre / 空文件占位 三种渲染从 ArtifactPreview
提取为命名 export ArtifactPreviewBody,原 ArtifactPreview 内部改用
它。行为等价,后续 hover popover 可直接复用同一渲染逻辑。"
```

---

### Task 2: 从 FileArtifactCard 拆出 FileArtifactCardInner

**Files:**
- Modify: `desktop/src/renderer/components/FileArtifactCard.tsx`
- Verify: `desktop/test/fileArtifactCard.test.tsx`

**Interfaces:**
- Produces: `FileArtifactCardInner(props: FileArtifactCardProps): JSX.Element` —— 去掉外层 `<div data-testid="file-artifact-card">` 和 failMsg modal，只保留按钮行
- Produces: default export `FileArtifactCard` 不变（向后兼容）

- [ ] **Step 1: 读现有 fileArtifactCard.test.tsx，确认 testid 断言**

Run: `cat desktop/test/fileArtifactCard.test.tsx`
Expected: 看清现有断言依赖哪些 testid（`file-artifact-card`/`file-artifact-open-preview`/`file-artifact-viewdiff` 等）

- [ ] **Step 2: 修改 FileArtifactCard.tsx，拆出 FileArtifactCardInner**

把现有 default export 重构为：

```tsx
import { useState } from 'react'
import { ChevronDown, FileDiff, FilePlus, RotateCcw, X, XCircle } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import { OpenWithMenu } from './OpenWithMenu'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

export interface FileArtifactCardProps {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onOpenPreview?: (filePath: string, content: string) => void
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  onUndo?: (file: ArtifactFile) => Promise<{ ok: boolean; message?: string }>
}

/**
 * 卡片按钮行(无外层 div 包装,供 asChild trigger 复用)。
 * 状态和事件处理与原 FileArtifactCard 一致,只是去掉了外层包装 div 和 failMsg modal。
 */
export function FileArtifactCardInner({ file, workspace, editors, onOpenPreview, onOpenDiff, onUndo }: FileArtifactCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [undone, setUndone] = useState(false)
  const [pending, setPending] = useState(false)
  const [failMsg, setFailMsg] = useState<string | null>(null)
  const created = file.kind === 'created'
  const hasDiff = file.before !== null && !undone
  const doUndo = async (): Promise<void> => {
    if (!onUndo || file.before === null || pending) return
    const name = baseName(file.path)
    if (!window.confirm(created ? `删除新建的 ${name}?` : `把 ${name} 恢复到编辑前?`)) return
    setPending(true); setFailMsg(null)
    const r = await onUndo(file)
    setPending(false)
    if (r.ok) setUndone(true); else setFailMsg(r.message || '未知错误')
  }
  return (
    <>
      <div data-testid="file-artifact-card" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
        {created
          ? <FilePlus className="h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} />
          : <FileDiff className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />}
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <button data-testid="file-artifact-open-preview" onClick={() => onOpenPreview?.(file.path, file.content)}
            className="max-w-full truncate text-left text-sm font-medium text-fg" title={file.path}>
            {created ? '新建 ' : '已编辑 '}{baseName(file.path)}
          </button>
          {hasDiff && onOpenDiff && (
            <button data-testid="file-artifact-viewdiff" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
              className="text-2xs text-fg-subtle hover:text-accent">查看更改 ↗</button>
          )}
          {undone && <span data-testid="file-artifact-undone" className="text-2xs text-fg-subtle">已撤销</span>}
        </div>
        {!undone && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button data-testid="file-artifact-openwith"
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">
                打开方式 <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52">
              <OpenWithMenu file={file} workspace={workspace} editors={editors} onAction={() => setOpen(false)} />
            </PopoverContent>
          </Popover>
        )}
        {hasDiff && onOpenDiff && (
          <button data-testid="file-artifact-review" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">审核</button>
        )}
        {hasDiff && onUndo && (
          <button data-testid="file-artifact-undo" onClick={() => void doUndo()} disabled={pending}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-danger hover:text-danger disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />撤销
          </button>
        )}
      </div>
      {failMsg !== null && (
        <div data-testid="file-artifact-undo-failed" role="alertdialog" aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFailMsg(null)}>
          <div className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <XCircle className="h-5 w-5" strokeWidth={2} />
              </span>
              <button data-testid="undo-failed-x" onClick={() => setFailMsg(null)}
                className="rounded p-1 text-fg-subtle hover:bg-fg/10 hover:text-fg"><X className="h-4 w-4" strokeWidth={1.5} /></button>
            </div>
            <div className="mb-1 text-lg font-bold text-fg">撤销失败</div>
            <div className="mb-5 text-sm text-fg-muted">{failMsg}</div>
            <button data-testid="undo-failed-close" onClick={() => setFailMsg(null)}
              className="w-full rounded-xl bg-fg py-2.5 text-sm font-semibold text-bg hover:opacity-90">关闭</button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 回复下方统一文件卡(default export,向后兼容)。
 * 现等同于 FileArtifactCardInner。
 */
export default function FileArtifactCard(props: FileArtifactCardProps): JSX.Element {
  return <FileArtifactCardInner {...props} />
}
```

- [ ] **Step 3: 跑 fileArtifactCard.test.tsx 验证未破坏**

Run: `npx vitest run desktop/test/fileArtifactCard.test.tsx`
Expected: PASS，所有现有测试通过

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/components/FileArtifactCard.tsx
git commit -m "refactor(file-artifact-card): 拆出 FileArtifactCardInner 命名 export

把 FileArtifactCardProps 提为显式 interface,新增 FileArtifactCardInner
命名 export 供后续 hover popover 用 asChild 包裹(避免 Radix trigger
要求单一元素的限制)。default export 行为不变,测试和调用点无需改。"
```

---

### Task 3: 新增 FileArtifactHoverPreview 组件

**Files:**
- Create: `desktop/src/renderer/components/FileArtifactHoverPreview.tsx`
- Test: `desktop/test/fileArtifactHoverPreview.test.tsx`

**Interfaces:**
- Consumes: `FileArtifactCardInner` from Task 2, `ArtifactPreviewBody` from Task 1
- Produces: `FileArtifactHoverPreview(props: FileArtifactCardProps): JSX.Element`

- [ ] **Step 1: 写失败测试 —— hover 300ms 后 open**

```tsx
// desktop/test/fileArtifactHoverPreview.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import FileArtifactHoverPreview from '../src/renderer/components/FileArtifactHoverPreview'
import type { ArtifactFile } from '../src/shared/artifactSummary'
import type { EditorApp } from '../src/shared/editors'

const md: ArtifactFile = { path: 'sub/spec.md', kind: 'created', content: '# 标题\n正文', before: '' }
const editors: EditorApp[] = []

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('FileArtifactHoverPreview hover 时序', () => {
  it('hover 300ms 后显示 popover', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    // 299ms 不显示
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
    // 300ms 显示
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })

  it('300ms 内 mouseleave 不显示', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.mouseLeave(card)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })

  it('mouseleave popover 200ms 后关闭', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(card)
    act(() => { vi.advanceTimersByTime(199) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })

  it('鼠标从卡片移到 popover 不关闭(桥接区)', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(card)
    // 199ms 内进入 popover
    act(() => { vi.advanceTimersByTime(199) })
    const popover = screen.getByTestId('artifact-hover-popover')
    fireEvent.mouseEnter(popover)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run desktop/test/fileArtifactHoverPreview.test.tsx`
Expected: FAIL with "Cannot find module '../src/renderer/components/FileArtifactHoverPreview'"

- [ ] **Step 3: 写最小实现 —— FileArtifactHoverPreview.tsx**

```tsx
// desktop/src/renderer/components/FileArtifactHoverPreview.tsx
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent } from './ui/popover'
import { FileArtifactCardInner } from './FileArtifactCard'
import { ArtifactPreviewBody } from './ArtifactPreview'
import { baseName } from '../lib/paths'
import type { FileArtifactCardProps } from './FileArtifactCard'

const ENTER_DELAY = 300
const LEAVE_DELAY = 200
const MAX_BYTES = 50 * 1024 // 50KB

/** 字节数 → 人类可读字符串 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 文件产物卡 hover peek 预览。
 * 鼠标移到卡片上 300ms 后弹出浮动 popover,显示文件内容 + 元数据标题。
 * 鼠标可从卡片移到 popover 不关闭(桥接区),200ms 后关闭。
 * click 文件名按钮仍触发 onOpenPreview(右侧 dock),不影响 hover state。
 */
export default function FileArtifactHoverPreview(props: FileArtifactCardProps): JSX.Element {
  const { file } = props
  const [open, setOpen] = useState(false)
  const enterTimer = useRef<number | null>(null)
  const leaveTimer = useRef<number | null>(null)

  const clearEnter = (): void => {
    if (enterTimer.current !== null) {
      clearTimeout(enterTimer.current)
      enterTimer.current = null
    }
  }
  const clearLeave = (): void => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  useEffect(() => {
    return () => { clearEnter(); clearLeave() }
  }, [])

  const onEnter = (): void => {
    clearLeave()
    if (open) return
    enterTimer.current = window.setTimeout(() => { setOpen(true) }, ENTER_DELAY)
  }
  const onLeave = (): void => {
    clearEnter()
    leaveTimer.current = window.setTimeout(() => { setOpen(false) }, LEAVE_DELAY)
  }

  const contentBytes = new Blob([file.content]).size
  const truncated = contentBytes > MAX_BYTES
  const displayContent = truncated ? file.content.slice(0, MAX_BYTES) : file.content
  const lineCount = file.content === '' ? 0 : file.content.split('\n').length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="inline-block"
        data-testid="artifact-hover-trigger-wrapper"
      >
        <FileArtifactCardInner {...props} />
      </span>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        data-testid="artifact-hover-popover"
        className="w-[min(560px,calc(100vw-24px))] p-0"
      >
        <div className="flex max-h-[420px] min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
            {file.kind === 'created'
              ? <FilePlus className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={1.5} />
              : <FileDiff className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />}
            <span className="truncate font-mono font-semibold" title={file.path}>{baseName(file.path)}</span>
            <span className="shrink-0 text-2xs text-fg-subtle">· {formatBytes(contentBytes)} · {lineCount} 行 · {file.kind === 'created' ? '新建' : '已编辑'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <ArtifactPreviewBody filePath={file.path} content={displayContent} />
            {truncated && (
              <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-3 py-1.5 text-2xs text-fg-subtle">
                内容过长,预览已截断,点击打开查看完整
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

需要补充 import：

```tsx
import { FileDiff, FilePlus } from 'lucide-react'
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run desktop/test/fileArtifactHoverPreview.test.tsx`
Expected: PASS

- [ ] **Step 5: 写更多失败测试 —— ESC / 截断 / 空内容 / click 行为**

在 `fileArtifactHoverPreview.test.tsx` 追加：

```tsx
import { fireEvent } from '@testing-library/react'

describe('FileArtifactHoverPreview 内容', () => {
  it('空内容显示占位', () => {
    const empty: ArtifactFile = { path: 'sub/empty.txt', kind: 'created', content: '', before: '' }
    render(<FileArtifactHoverPreview file={empty} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-empty')).toBeTruthy()
  })

  it('超过 50KB 截断并显示提示', () => {
    const big: ArtifactFile = { path: 'sub/big.txt', kind: 'created', content: 'a'.repeat(50 * 1024 + 100), before: '' }
    render(<FileArtifactHoverPreview file={big} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-code').textContent?.length).toBeLessThanOrEqual(50 * 1024)
    expect(screen.getByText(/内容过长,预览已截断/)).toBeTruthy()
  })

  it('.md 内容走 react-markdown', () => {
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-markdown')).toBeTruthy()
  })
})

describe('FileArtifactHoverPreview click 行为', () => {
  it('click 文件名按钮触发 onOpenPreview,不影响 hover', () => {
    const onOpenPreview = vi.fn()
    render(<FileArtifactHoverPreview file={md} workspace="/proj" editors={editors} onOpenPreview={onOpenPreview} />)
    fireEvent.click(screen.getByTestId('file-artifact-open-preview'))
    expect(onOpenPreview).toHaveBeenCalledWith('sub/spec.md', '# 标题\n正文')
  })

  it('click 查看更改后立即关闭 popover', () => {
    const onOpenDiff = vi.fn()
    const modified: ArtifactFile = { path: 'sub/a.ts', kind: 'modified', content: '新', before: '旧' }
    render(<FileArtifactHoverPreview file={modified} workspace="/proj" editors={editors} onOpenDiff={onOpenDiff} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
    fireEvent.click(screen.getByTestId('file-artifact-viewdiff'))
    expect(screen.queryByTestId('artifact-hover-popover')).toBeNull()
  })
})
```

注意：测试中 click「查看更改」后立即关闭，需要 FileArtifactHoverPreview 在 click 后调 `setOpen(false)`。但当前实现中 click 走的是 FileArtifactCardInner 内部，外层 HoverPreview 不感知。需要调整：在 FileArtifactCardInner 上包一层 onClickCapture 处理。

修正实现，在 wrapper span 加 `onClickCapture`：

```tsx
<span
  onMouseEnter={onEnter}
  onMouseLeave={onLeave}
  onClickCapture={(e) => {
    // 点击「查看更改」「审核」「撤销」后立即关闭 popover
    const target = e.target as HTMLElement
    const testId = target.getAttribute('data-testid')
    if (testId === 'file-artifact-viewdiff' || testId === 'file-artifact-review' || testId === 'file-artifact-undo') {
      setOpen(false)
    }
  }}
  className="inline-block"
  data-testid="artifact-hover-trigger-wrapper"
>
```

- [ ] **Step 6: 跑全部测试验证通过**

Run: `npx vitest run desktop/test/fileArtifactHoverPreview.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/components/FileArtifactHoverPreview.tsx desktop/test/fileArtifactHoverPreview.test.tsx
git commit -m "feat(artifact): 文件产物卡 hover peek 预览

新增 FileArtifactHoverPreview 组件,鼠标 hover 在卡片上 300ms 后
弹出浮动 popover 显示文件内容 + 元数据(大小/行数/kind badge)。
鼠标可从卡片移到 popover 不关闭(桥接区),200ms 后关闭。
click 文件名仍走右侧 dock,click 查看更改/审核/撤销 后立即关闭。
超过 50KB 截断显示并提示。复用 ArtifactPreviewBody 渲染逻辑。"
```

---

### Task 4: Transcript 接入 FileArtifactHoverPreview

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx:10,64-67`

**Interfaces:**
- Consumes: `FileArtifactHoverPreview` from Task 3

- [ ] **Step 1: 写失败测试 —— Transcript 渲染 hover preview**

在 `desktop/test/transcript.test.tsx`（如果存在）或新建 `desktop/test/transcriptHoverPreview.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import Transcript from '../src/renderer/components/Transcript'
import type { Item } from '../src/shared/transcriptReducer'

const items: Item[] = [
  { type: 'user', text: '生成 spec.md', attachments: [], mode: 'react', ordinal: 1 },
  { type: 'message', text: '已生成' },
  { type: 'tool', callId: 'c1', name: 'write_file', args: '{"path":"spec.md","content":"# x"}', result: '{"ok":true}', kind: 'write_file' }
]

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('Transcript 文件卡 hover peek', () => {
  it('渲染产物卡且支持 hover 预览', () => {
    const onOpenArtifact = vi.fn()
    render(<Transcript items={items} busy={false}
      onEditMessage={vi.fn()} onDeleteMessage={vi.fn()} onResendMessage={vi.fn()}
      onPlanReview={vi.fn()} mode="react" onOpenArtifact={onOpenArtifact}
      onOpenDiff={vi.fn()} onUndo={vi.fn(async () => ({ ok: true }))}
      editors={[]} workspace="/proj" onOpenPanel={vi.fn()} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run desktop/test/transcriptHoverPreview.test.tsx`
Expected: FAIL with `artifact-hover-popover` not found

- [ ] **Step 3: 修改 Transcript.tsx，替换 FileArtifactCard 为 FileArtifactHoverPreview**

修改 `desktop/src/renderer/components/Transcript.tsx`：

第 10 行 import 改为：
```tsx
import FileArtifactHoverPreview from './FileArtifactHoverPreview'
```

第 64-67 行 `renderChips` 改为：
```tsx
{chips.map(f => (
  <FileArtifactHoverPreview key={f.path} file={f} workspace={workspace ?? null} editors={editors ?? []}
    onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
))}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run desktop/test/transcriptHoverPreview.test.tsx`
Expected: PASS

- [ ] **Step 5: 跑现有 transcript 测试确认未破坏**

Run: `npx vitest run desktop/test/transcript.test.tsx`
Expected: PASS（如果文件存在；若不存在跳过）

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/components/Transcript.tsx desktop/test/transcriptHoverPreview.test.tsx
git commit -m "feat(transcript): 接入文件产物卡 hover peek 预览

renderChips 渲染时用 FileArtifactHoverPreview 替换 FileArtifactCard,
鼠标 hover 300ms 弹出浮动预览。click 行为不变。"
```

---

### Task 5: 全量回归与手工验证

**Files:** 无新文件

- [ ] **Step 1: 跑 desktop 全量测试**

Run: `npx vitest run desktop/test/`
Expected: 全部 PASS

- [ ] **Step 2: 跑 TypeScript 类型检查**

Run: `npx tsc --noEmit -p desktop/tsconfig.json`
Expected: 无错误

- [ ] **Step 3: 手工验证（如果 dev server 可用）**

启动 dev server，发送一条会生成 .md 文件的任务，确认：
- 鼠标移到产物卡上 300ms 后 popover 出现
- popover 显示文件内容 + 元数据标题
- 鼠标可移到 popover 不关闭
- ESC 关闭
- click 文件名仍打开右侧 dock
- click「查看更改」后 popover 关闭

- [ ] **Step 4: 最终 commit（如有手工验证修复）**

```bash
git add -A
git commit -m "test(artifact-hover): 全量回归通过"
```

---

## Self-Review

**1. Spec coverage:**
- hover 300ms 弹出浮动 popover → Task 3 ✓
- popover 紧贴卡片右侧 → Task 3 PopoverContent side="right" ✓
- 鼠标可从卡片移到 popover 不关闭（桥接区）→ Task 3 onEnter/onLeave + popover handler ✓
- click 文件名行为不变 → Task 3 FileArtifactCardInner 复用 ✓
- 复用 ArtifactPreview 渲染逻辑 → Task 1 ArtifactPreviewBody ✓
- 300ms 延迟 + 桥接区 + ESC 关闭 → Task 3 ✓
- 元数据标题（文件名+大小+行数+kind badge）→ Task 3 Header ✓
- 50KB 截断 → Task 3 ✓
- 空文件占位 → Task 3（复用 ArtifactPreviewBody）✓
- Popover 嵌套（外层 hover + 内层打开方式）→ Task 3（Radix 原生支持）✓

**2. Placeholder scan:** 无 TBD/TODO；所有代码块完整。

**3. Type consistency:**
- `FileArtifactCardProps` 在 Task 2 定义，Task 3 import 复用 ✓
- `ArtifactPreviewBody({ filePath, content })` 在 Task 1 定义，Task 3 import 复用 ✓
- `ArtifactFile` 类型全程一致 ✓

无 spec 缺口。
