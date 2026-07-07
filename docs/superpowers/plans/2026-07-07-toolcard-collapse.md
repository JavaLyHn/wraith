# 工具调用卡片默认折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具调用卡片结果默认折叠（只显卡头），运行中/失败自动展开、完成成功自动收起，点头手动切换。

**Architecture:** 纯函数 `toolCardDefaultExpanded(card)` 给智能默认；`ToolCard` 用 `userToggled: boolean|null` + `expanded = userToggled ?? 默认` 解析，卡头变可点行 + chevron，`<pre>` 仅展开时渲染。零后端。

**Tech Stack:** React + Tailwind；vitest（`desktop/test/`）；门禁 tsc + vitest + build。

## Global Constraints

- 工作目录 `desktop/`。桌面渲染层，零后端；只动 `ToolCard`（不碰 ThinkingBlock/DiffCard/AgentMessage）。
- 组件层无 RTL：纯逻辑抽函数走 vitest；UI 接线走 typecheck + build + 眼验。门禁：`npm run typecheck` + `npm run test`（不回归）+ `npm run build` 全绿。
- 无密钥面。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支：接在 `feat/resend-message`（当前分支）。

## File Structure

- `desktop/src/renderer/lib/toolCardExpand.ts` — 新建纯函数 `toolCardDefaultExpanded`。
- `desktop/test/toolCardExpand.test.ts` — 新建 vitest。
- `desktop/src/renderer/components/ToolCard.tsx` — 加 state + chevron + 可点卡头 + 条件渲染 pre。

---

### Task 1: 纯函数 toolCardDefaultExpanded + 单测

**Files:**
- Create: `desktop/src/renderer/lib/toolCardExpand.ts`
- Test: `desktop/test/toolCardExpand.test.ts`

**Interfaces:**
- Produces: `toolCardDefaultExpanded(card: { done: boolean; ok?: boolean }): boolean` —— 供 Task 2 的 ToolCard 解析默认展开态。

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/toolCardExpand.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { toolCardDefaultExpanded } from '../src/renderer/lib/toolCardExpand'

describe('toolCardDefaultExpanded', () => {
  it('运行中(done:false)→展开', () => {
    expect(toolCardDefaultExpanded({ done: false })).toBe(true)
  })
  it('完成且成功(done:true, ok:true)→折叠', () => {
    expect(toolCardDefaultExpanded({ done: true, ok: true })).toBe(false)
  })
  it('失败(done:true, ok:false)→展开', () => {
    expect(toolCardDefaultExpanded({ done: true, ok: false })).toBe(true)
  })
  it('完成但 ok 未定义(done:true)→折叠', () => {
    expect(toolCardDefaultExpanded({ done: true })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/toolCardExpand.test.ts`
Expected: FAIL —— 模块 `../src/renderer/lib/toolCardExpand` 不存在。

- [ ] **Step 3: 写实现**

新建 `desktop/src/renderer/lib/toolCardExpand.ts`：

```ts
/** 智能默认:运行中或失败→展开;完成且成功→折叠。 */
export function toolCardDefaultExpanded(card: { done: boolean; ok?: boolean }): boolean {
  return !card.done || card.ok === false
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/toolCardExpand.test.ts`
Expected: PASS —— 4 passed。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/lib/toolCardExpand.ts test/toolCardExpand.test.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): toolCardDefaultExpanded 纯函数(运行中/失败展开,完成成功折叠)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 2: ToolCard 折叠交互

**Files:**
- Modify: `desktop/src/renderer/components/ToolCard.tsx`

**Interfaces:**
- Consumes: `toolCardDefaultExpanded`（Task 1）；既有 `ToolCard` 类型、`toolBadgeLabel`。

- [ ] **Step 1: 整文件替换 ToolCard.tsx**

整文件替换 `desktop/src/renderer/components/ToolCard.tsx` 为：

```tsx
import { useState } from 'react'
import type { ToolCard as ToolCardType } from '../../shared/transcriptReducer'
import { toolBadgeLabel } from '../../shared/toolBadge'
import { toolCardDefaultExpanded } from '../lib/toolCardExpand'

interface ToolCardProps {
  card: ToolCardType
}

export default function ToolCard({ card }: ToolCardProps): JSX.Element {
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const expanded = userToggled ?? toolCardDefaultExpanded(card)

  const badgeClass = card.done
    ? card.ok === false
      ? 'bg-danger text-white'
      : 'bg-ok text-white'
    : 'bg-accent/15 text-accent'

  return (
    <div
      data-testid="tool-card"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <button
        type="button"
        data-testid="tool-card-header"
        onClick={() => setUserToggled(!expanded)}
        aria-expanded={expanded}
        className={
          'flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-fg/[0.03] ' +
          (expanded ? 'border-b border-border' : '')
        }
      >
        <span className="shrink-0 text-fg-subtle">{expanded ? '▾' : '▸'}</span>
        <span className="font-semibold text-accent">{card.name}</span>
        <span className="flex-1 truncate text-fg-muted">{card.argsJson}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-2xs ${card.done ? 'font-semibold' : ''} ${badgeClass}`}
        >
          {toolBadgeLabel(card)}
        </span>
      </button>
      {expanded && (
        <pre
          data-testid="tool-output"
          className="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-fg-muted"
        >
          {card.output || ' '}
        </pre>
      )}
    </div>
  )
}
```

要点：卡头由 `<div>` 改 `<button>`（`w-full text-left` 保持布局、hover 淡底、`aria-expanded`）；左加 chevron；`border-b` 由常驻改为**仅展开时**（折叠卡头下方无悬空边线）；`<pre>` 仅 `expanded` 时渲染，`data-testid="tool-output"` 保留。

- [ ] **Step 2: 门禁 —— typecheck + vitest 不回归 + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected: typecheck exit 0；vitest 全绿（含 Task 1 的 toolCardExpand 4 例 + 既有不回归）；build 成功。

（UI 接线无独立单测——门禁即三门 + 眼验,符合项目「组件无 RTL」约定。）

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/components/ToolCard.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): 工具调用卡片默认折叠 —— 卡头可点展开,pre 条件渲染

结果默认折叠只显卡头;expanded = userToggled ?? toolCardDefaultExpanded(card):
运行中/失败自动展开、完成成功自动收起,点卡头手动切换固定。chevron ▸/▾ 指示。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

## 交付后（人工/主循环）

- 眼验：卡片默认折叠只剩卡头；运行中展开看实时输出、完成后自动收起；失败保持展开；点卡头手动展/收生效；chevron 方向对。
- 与 resend + markdown + composer 一起眼验通过 → FF-merge + 推送（推送前用户点头）。

## Self-Review

**1. Spec 覆盖：** 智能默认(运行中/失败展开、完成成功折叠)→ Task 1 纯函数 + Task 2 解析;手动切换固定→ `userToggled ?? 默认`(Task 2);卡头可点 + chevron + pre 条件渲染→ Task 2;只动 ToolCard→ 文件清单。✓
**2. 占位符扫描：** 无 TBD/TODO；两文件完整代码 + ToolCard 整文件替换。✓
**3. 一致性：** `toolCardDefaultExpanded({done, ok?})` Task 1 定义与 Task 2 import/调用一致；`ToolCardType`/`toolBadgeLabel` import 路径与现文件一致；`data-testid` tool-card/tool-output 保留 + 新增 tool-card-header。✓
