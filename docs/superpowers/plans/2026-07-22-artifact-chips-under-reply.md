# 回复下方「本回合产物」文件 chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个回合最后一条 agent 回复下方,渲染本回合 `write_file` 产出文件的 chip;点击在右侧「预览」pane 渲染完整内容。

**Architecture:** 纯前端、零后端。从 `deriveArtifacts` 抽出纯函数 `deriveFiles(items)`;新纯函数 `filesUnderMessages(items)` 按 `user` 边界分回合、把该回合产出文件挂到最后一条 `message` 的绝对下标;新组件 `ArtifactChips` 渲染 pill;`Transcript` 命中下标时在 `AgentMessage` 下方渲染 chip(复用现有 `onOpenArtifact` → `openArtifact` → 右侧预览)。

**Tech Stack:** TypeScript, React, lucide/emoji, vitest + @testing-library/react(jsdom)。

## Global Constraints

- 纯前端,**不改 Java、不重打 jar**;改动仅限 `desktop/`。主 worktree `~/Desktop/wraith/desktop`(HMR)。
- **前置**:开始 Task 1 前,先提交工作区里已验证的 no-op 产物修复(`artifactSummary.ts` + `artifactSummary.test.ts`)作为干净基线(见下「Pre-Task」)。
- 内容源与 `deriveArtifacts` 同源(write_file 卡 argsJson content / diff after),**不读实时磁盘**。
- `originalIdx`(groupToolRuns 给的)== `items` 数组绝对下标(已核实 `groupToolRuns.ts:53`)——`filesUnderMessages` 的 key 与之一致。
- `onOpenArtifact` 已是 `Transcript` 的可选 prop(上一功能 Task 4 加),App 已传 `openArtifact`;`ArtifactFile`/`baseName` 已存在。
- 复用:`ArtifactFile`、`writeFileArgs`(`src/shared/artifactSummary.ts`)、`baseName`(`src/renderer/lib/paths.ts`)、`AgentMessage`(布局:`flex gap-2.5` + `w-6` logo)。
- 测试从 `desktop/` 跑:`npx vitest run <file>`、`npx tsc --noEmit`。
- 提交只 `git add` 本任务文件,不碰仓库既有 WIP。

## Pre-Task(执行者先做,不属评审任务)

提交已在工作区、已通过 894 全量回归的 no-op 修复:

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/artifactSummary.ts desktop/test/artifactSummary.test.ts
git commit -m "fix(desktop): 产物摘要也计入 write_file(含 no-op 重写),修\"写了文件却暂无产物\""
```

---

### Task 1: 抽出 `deriveFiles` 纯函数

**Files:**
- Modify: `desktop/src/shared/artifactSummary.ts`
- Modify: `desktop/test/artifactSummary.test.ts`

**Interfaces:**
- Produces: `export function deriveFiles(items: readonly Item[]): ArtifactFile[]` —— 只做文件提取(write_file 卡 + diff 合并,与现有 `deriveArtifacts` 文件逻辑完全一致)。
- `deriveArtifacts` 改为内部调用 `deriveFiles(items)` 得 `files`,其余(servers/browser/team/sources/isEmpty)不变,**对外行为零变化**。

- [ ] **Step 1: 写 deriveFiles 测试(先失败)**

在 `desktop/test/artifactSummary.test.ts` 顶部 import 改为:
```ts
import { deriveArtifacts, deriveFiles } from '../src/shared/artifactSummary'
```
在文件末尾 `})`(describe('deriveArtifacts') 收尾)**之后**追加:
```ts
describe('deriveFiles', () => {
  const tool = (name: string, argsJson: string, output = ''): Item =>
    ({ type: 'tool', card: { callId: 'c-' + name, name, argsJson, output, done: true } })

  it('write_file 卡计入(含 no-op),按 path 去重、content 取最新', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'a.md', content: 'v1' })),
      tool('write_file', JSON.stringify({ path: 'a.md', content: 'v2' })),
    ]
    expect(deriveFiles(items)).toEqual([{ path: 'a.md', kind: 'modified', content: 'v2' }])
  })

  it('write_file 卡 + 同路径 diff 合并成一条(diff 定 created)', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'new.md', content: 'x' })),
      { type: 'diff', filePath: 'new.md', before: '', after: 'x' },
    ]
    expect(deriveFiles(items)).toEqual([{ path: 'new.md', kind: 'created', content: 'x' }])
  })

  it('ok=false 的 write_file 不计', () => {
    const items: Item[] = [
      { type: 'tool', card: { callId: 'c1', name: 'write_file', argsJson: JSON.stringify({ path: 'x', content: 'y' }), output: '', done: true, ok: false } },
    ]
    expect(deriveFiles(items)).toEqual([])
  })

  it('无产物 → 空数组', () => {
    expect(deriveFiles([{ type: 'message', text: 'hi' }])).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts`
Expected: FAIL —— `deriveFiles` 未导出。

- [ ] **Step 3: 实现 deriveFiles + deriveArtifacts 改用它**

在 `desktop/src/shared/artifactSummary.ts`,在 `deriveArtifacts` 函数**之前**新增:
```ts
/**
 * 从 items 提取「产物文件」:write_file 工具卡(含 no-op 重写,ok!==false)与 diff 合并;
 * diff 决定 created/modified(before==='' 为新建且不降级),content 取最新;按 path 去重保序。
 */
export function deriveFiles(items: readonly Item[]): ArtifactFile[] {
  const files = new Map<string, ArtifactFile>()
  for (const item of items) {
    if (item.type === 'diff') {
      if (item.filePath) {
        const existing = files.get(item.filePath)
        const created = item.before === '' || existing?.kind === 'created'
        files.set(item.filePath, { path: item.filePath, kind: created ? 'created' : 'modified', content: item.after })
      }
    } else if (item.type === 'tool') {
      const wf = writeFileArgs(item.card)
      if (wf) {
        const existing = files.get(wf.path)
        files.set(wf.path, existing ? { ...existing, content: wf.content } : { path: wf.path, kind: 'modified', content: wf.content })
      }
    }
  }
  return [...files.values()]
}
```

把 `deriveArtifacts` 改成不再自己算 files:
- 删除函数体里 `const files = new Map<string, ArtifactFile>()` 这一行;
- 删除 `for` 循环里整个 `case 'diff': { ... }` 块;
- 删除 `case 'tool':` 块里的 `const wf = writeFileArgs(card) ... }`(那 5 行 wf 处理),tool 块只保留 execute_command 与 browser 两段;
- 把 `const fileList = [...files.values()]` 改为 `const fileList = deriveFiles(items)`。

改完后 `deriveArtifacts` 的 tool 块形如:
```ts
      case 'tool': {
        const card = item.card
        if (card.name === 'execute_command' && card.output) {
          for (const raw of card.output.match(LOOPBACK_RE) ?? []) {
            const url = normalizeLoopback(raw)
            if (!servers.has(url)) servers.set(url, { url })
          }
        }
        if (card.name.startsWith('browser') || card.name.startsWith('mcp__chrome-devtools__')) {
          const argUrl = browserArgUrl(card)
          if (argUrl) {
            lastArgUrl = argUrl
          } else if (!isNonNavBrowserTool(card.name) && card.output) {
            const m = card.output.match(HTTP_RE)
            if (m) lastOutputUrl = m[0]
          }
        }
        break
      }
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `cd desktop && npx vitest run test/artifactSummary.test.ts`
Expected: PASS —— 原 deriveArtifacts 用例(含文件用例)全绿 + 新 deriveFiles 4 用例绿(证明抽取行为一致)。
Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/artifactSummary.ts desktop/test/artifactSummary.test.ts
git commit -m "refactor(desktop): 抽出 deriveFiles 纯函数(deriveArtifacts 复用,行为不变)"
```

---

### Task 2: `filesUnderMessages` 纯函数

**Files:**
- Modify: `desktop/src/shared/artifactSummary.ts`
- Test: `desktop/test/filesUnderMessages.test.ts`

**Interfaces:**
- Consumes: `deriveFiles`(Task 1)。
- Produces: `export function filesUnderMessages(items: readonly Item[]): Map<number, ArtifactFile[]>` —— key = 该回合最后一条 `message` 项在 `items` 里的绝对下标,value = 该回合产出文件(非空)。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/filesUnderMessages.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { filesUnderMessages } from '../src/shared/artifactSummary'
import type { Item } from '../src/shared/transcriptReducer'

const wf = (path: string, content: string): Item =>
  ({ type: 'tool', card: { callId: 'c-' + path, name: 'write_file', argsJson: JSON.stringify({ path, content }), output: '', done: true } })
const user = (text: string): Item => ({ type: 'user', text })
const msg = (text: string): Item => ({ type: 'message', text })

describe('filesUnderMessages', () => {
  it('单回合:文件挂到该回合的 message 下标', () => {
    const items: Item[] = [user('写readme'), wf('README.md', '你好'), msg('已生成')]
    const m = filesUnderMessages(items)
    expect([...m.keys()]).toEqual([2])
    expect(m.get(2)).toEqual([{ path: 'README.md', kind: 'modified', content: '你好' }])
  })

  it('一回合多文件:全挂同一 message', () => {
    const items: Item[] = [user('写两个'), wf('a.ts', 'A'), wf('b.ts', 'B'), msg('done')]
    expect(filesUnderMessages(items).get(3)).toEqual([
      { path: 'a.ts', kind: 'modified', content: 'A' },
      { path: 'b.ts', kind: 'modified', content: 'B' },
    ])
  })

  it('两回合:各自文件挂各自 message,不串', () => {
    const items: Item[] = [user('t1'), wf('a.ts', 'A'), msg('m1'), user('t2'), wf('b.ts', 'B'), msg('m2')]
    const m = filesUnderMessages(items)
    expect(m.get(2)).toEqual([{ path: 'a.ts', kind: 'modified', content: 'A' }])
    expect(m.get(5)).toEqual([{ path: 'b.ts', kind: 'modified', content: 'B' }])
  })

  it('回合有文件但无 message:不产生条目', () => {
    const items: Item[] = [user('t'), wf('a.ts', 'A')]
    expect(filesUnderMessages(items).size).toBe(0)
  })

  it('回合有 message 但无文件:不产生条目', () => {
    const items: Item[] = [user('hi'), msg('你好')]
    expect(filesUnderMessages(items).size).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/filesUnderMessages.test.ts`
Expected: FAIL —— `filesUnderMessages` 未导出。

- [ ] **Step 3: 实现**

在 `desktop/src/shared/artifactSummary.ts` 末尾(`deriveArtifacts` 之后)新增:
```ts
/**
 * 把「本回合产出的文件」挂到该回合最后一条 message 项的绝对下标。
 * 回合以 `user` 项为界;回合无 message 或无文件 → 不产生条目。
 * key 与 groupToolRuns 的 originalIdx(= items 绝对下标)一致,供 Transcript 命中渲染 chip。
 */
export function filesUnderMessages(items: readonly Item[]): Map<number, ArtifactFile[]> {
  const out = new Map<number, ArtifactFile[]>()
  let turnStart = 0
  let lastMsgIdx = -1
  const flush = (endExclusive: number): void => {
    if (lastMsgIdx >= 0) {
      const files = deriveFiles(items.slice(turnStart, endExclusive))
      if (files.length > 0) out.set(lastMsgIdx, files)
    }
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it) continue
    if (it.type === 'user') { flush(i); turnStart = i; lastMsgIdx = -1 }
    else if (it.type === 'message') { lastMsgIdx = i }
  }
  flush(items.length)
  return out
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `cd desktop && npx vitest run test/filesUnderMessages.test.ts`
Expected: PASS(5 用例)。
Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/artifactSummary.ts desktop/test/filesUnderMessages.test.ts
git commit -m "feat(desktop): filesUnderMessages — 按回合把产物文件挂到最后一条回复"
```

---

### Task 3: `ArtifactChips` 组件

**Files:**
- Create: `desktop/src/renderer/components/ArtifactChips.tsx`
- Test: `desktop/test/artifactChips.test.tsx`

**Interfaces:**
- Consumes: `ArtifactFile`、`baseName`。
- Produces: `export default function ArtifactChips(props: { files: ArtifactFile[]; onOpenArtifact: (filePath: string, content: string) => void }): JSX.Element | null`。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/artifactChips.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ArtifactChips from '../src/renderer/components/ArtifactChips'
import type { ArtifactFile } from '../src/shared/artifactSummary'

afterEach(() => cleanup())

const files: ArtifactFile[] = [
  { path: 'src/README.md', kind: 'created', content: '你好' },
  { path: 'a/b/main.ts', kind: 'modified', content: 'x' },
]

describe('ArtifactChips', () => {
  it('每个文件渲染一个 chip,显示 baseName', () => {
    render(<ArtifactChips files={files} onOpenArtifact={vi.fn()} />)
    const chips = screen.getAllByTestId('artifact-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.textContent).toContain('README.md')
    expect(chips[1]!.textContent).toContain('main.ts')
  })

  it('点 chip 调 onOpenArtifact(path, content)', () => {
    const onOpen = vi.fn()
    render(<ArtifactChips files={files} onOpenArtifact={onOpen} />)
    fireEvent.click(screen.getAllByTestId('artifact-chip')[0]!)
    expect(onOpen).toHaveBeenCalledWith('src/README.md', '你好')
  })

  it('空数组 → 不渲染', () => {
    const { container } = render(<ArtifactChips files={[]} onOpenArtifact={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/artifactChips.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

Create `desktop/src/renderer/components/ArtifactChips.tsx`:
```tsx
import { baseName } from '../lib/paths'
import type { ArtifactFile } from '../../shared/artifactSummary'

/**
 * agent 回复下方的「本回合产物」文件 chip 行。用与 AgentMessage 相同的两列布局
 * (w-6 占位 + gap-2.5)让 chip 与正文左对齐。点击在右侧「预览」pane 打开完整内容。
 */
export default function ArtifactChips({ files, onOpenArtifact }: {
  files: ArtifactFile[]
  onOpenArtifact: (filePath: string, content: string) => void
}): JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div data-testid="artifact-chips" className="flex gap-2.5">
      <div className="w-6 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {files.map(f => (
          <button
            key={f.path}
            data-testid="artifact-chip"
            title={f.path}
            onClick={() => onOpenArtifact(f.path, f.content)}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-2xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
          >
            <span aria-hidden>📄</span>
            <span className="max-w-[220px] truncate">{baseName(f.path)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `cd desktop && npx vitest run test/artifactChips.test.tsx`
Expected: PASS(3 用例)。
Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/ArtifactChips.tsx desktop/test/artifactChips.test.tsx
git commit -m "feat(desktop): ArtifactChips — 回复下方产物文件 pill(点击进右侧预览)"
```

---

### Task 4: Transcript 接线(消息下渲染 chip)

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx`

**Interfaces:**
- Consumes: `filesUnderMessages`(Task 2)、`ArtifactChips`(Task 3)、`Transcript` 现有 `onOpenArtifact?` prop。

- [ ] **Step 1: 改 Transcript**

在 `desktop/src/renderer/components/Transcript.tsx`:

(a) import 区加:
```tsx
import { Fragment, useEffect, useMemo, useRef } from 'react'
```
(把现有 `import { useEffect, useRef } from 'react'` 合并成上面这行,不要重复 import。)
再加两行组件 import:
```tsx
import ArtifactChips from './ArtifactChips'
import { filesUnderMessages } from '../../shared/artifactSummary'
```

(b) 在组件体内、`return (` 之前加:
```tsx
  const chipsByMsg = useMemo(() => filesUnderMessages(items), [items])
```

(c) 把渲染 `message` 项那段:
```tsx
        if (item.type === 'message') {
          return <AgentMessage key={`msg-${originalIdx}`} text={item.text} />
        }
```
替换为:
```tsx
        if (item.type === 'message') {
          const chips = chipsByMsg.get(originalIdx)
          return (
            <Fragment key={`msg-${originalIdx}`}>
              <AgentMessage text={item.text} />
              {chips && onOpenArtifact && <ArtifactChips files={chips} onOpenArtifact={onOpenArtifact} />}
            </Fragment>
          )
        }
```

- [ ] **Step 2: tsc + 相关测试 + 全量回归**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无输出。
Run: `cd desktop && npx vitest run test/artifactSummary.test.ts test/filesUnderMessages.test.ts test/artifactChips.test.tsx`
Expected: 全绿。
Run: `cd desktop && npx vitest run`
Expected: 全量全绿,无回归。

- [ ] **Step 3: 手动眼验(dev)**

renderer HMR 生效、无需重启/重打 jar。发「生成 readme 你好」→ agent 回复下方出现 `📄 README.md` chip,点它右侧「预览」渲染出内容;即便是 no-op 重写(无 diff 卡)也有 chip;多文件回合有多个 chip;chip 与正文左对齐。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/Transcript.tsx
git commit -m "feat(desktop): agent 回复下方渲染本回合产物文件 chip"
```

---

## 自查(spec 覆盖)

- 本回合产出所有文件、挂最后一条回复:Task 2 filesUnderMessages ✓
- 与 diff 卡并存(都显示):Task 4 不动 diff 卡,只加 chip ✓
- 点击进右侧预览(复用 openArtifact):Task 3 onOpenArtifact + Task 4 透传 ✓
- 内容源同 deriveArtifacts、不读盘:Task 1 deriveFiles ✓
- 无 message 回合不挂:Task 2 lastMsgIdx<0 跳过 ✓
- deriveArtifacts 行为零变化:Task 1 复用 deriveFiles,原用例保持绿 ✓
- key 与 originalIdx 一致(items 绝对下标):Task 2 + groupToolRuns.ts:53 ✓
- 类型/命名一致:`deriveFiles`/`filesUnderMessages`/`ArtifactChips`/`ArtifactFile`/`onOpenArtifact` 跨任务一致 ✓
