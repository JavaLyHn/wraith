# 消息「重新发送」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给聊天消息加一键「重新发送」，覆盖失败重试 / 原样重发 / 重新生成回复三场景。

**Architecture:** 三场景归一为同一回溯操作（丢弃第 N 条用户消息及之后、以原文本重提交）。抽共享 `rewindAndResubmit(ordinal, text)`（从现有 `handleEditMessage` 提取），edit 与 resend 都委托它。入口：用户消息 hover 🔄（最后一条一键、较早两击确认）+ 失败横幅 🔄。纯渲染层，零后端 / 零新 RPC。

**Tech Stack:** Electron + React + TypeScript；vitest（`desktop/test/*.test.ts`，`import from '../src/renderer/...'`）；门禁 tsc + vitest + electron-vite build。

## Global Constraints

- 工作目录 `desktop/`。桌面渲染层改动，**零后端 / 零新 RPC**；不改 `rewindSession` / `truncateAtUserOrdinal` 既有语义。
- 复用 `rewindAndResubmit` 回溯路径（`rewindSession → truncateAtUser → addUserItem → markStarted → submitTurn` + `turn.failed` 失败兜底），与主 submit 对称。
- 运行中（`turnRef.current === 'running'`）所有重发入口禁用/早返回，与 edit/delete 一致。
- 组件层无 RTL：纯逻辑抽函数走 vitest；UI 接线走 typecheck + build + 眼验（沿用本项目既有约定）。
- 门禁：`npm run typecheck` + `npm run test`（vitest）+ `npm run build` 全绿。
- 密钥红线：无密钥面；失败横幅复用现有 `submitError` 文案（已 URL/sk- 脱敏 + 80 字截断）。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支 `feat/resend-message`（off main `80ef066`）。

## File Structure

- `desktop/src/renderer/lib/resend.ts` — 新建：纯函数 `lastUserMessage(items)`。
- `desktop/test/resend.test.ts` — 新建：`lastUserMessage` 单测。
- `desktop/src/renderer/App.tsx` — 修改：抽 `rewindAndResubmit`、加 `handleResendMessage`、Transcript 传 `onResendMessage`、失败横幅传 `onResend`、import `lastUserMessage`。
- `desktop/src/renderer/components/Transcript.tsx` — 修改：加 `onResendMessage` prop + `isLastUser` 计算并下传。
- `desktop/src/renderer/components/UserMessage.tsx` — 修改：加 `isLastUser`/`onResend` props + 🔄 按钮（一键/两击确认分支）。
- `desktop/src/renderer/components/SubmitErrorBanner.tsx` — 修改：加可选 `onResend` prop + 🔄 按钮。

---

### Task 1: 纯函数 lastUserMessage + 单测

**Files:**
- Create: `desktop/src/renderer/lib/resend.ts`
- Test: `desktop/test/resend.test.ts`

**Interfaces:**
- Consumes: `Item` type from `desktop/src/shared/transcriptReducer`（`{ type: 'user'; text } | { type: 'message'; text } | { type: 'thinking'; label; text; done } | ...`）。
- Produces: `lastUserMessage(items: Item[]): { ordinal: number; text: string } | null` —— 供 Task 3 的失败横幅取最后一条用户消息。

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/resend.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { lastUserMessage } from '../src/renderer/lib/resend'
import type { Item } from '../src/shared/transcriptReducer'

const user = (text: string): Item => ({ type: 'user', text })
const agent = (text: string): Item => ({ type: 'message', text })

describe('lastUserMessage', () => {
  it('多条用户消息取最后一条(ordinal 1-based + text)', () => {
    const items: Item[] = [user('a'), agent('r1'), user('b'), agent('r2')]
    expect(lastUserMessage(items)).toEqual({ ordinal: 2, text: 'b' })
  })
  it('夹杂 agent/thinking 项不误算 user 序号', () => {
    const items: Item[] = [
      user('one'),
      { type: 'thinking', label: 'x', text: '', done: true },
      agent('r'),
      user('two'),
    ]
    expect(lastUserMessage(items)).toEqual({ ordinal: 2, text: 'two' })
  })
  it('无用户消息返回 null', () => {
    expect(lastUserMessage([agent('r')])).toBeNull()
    expect(lastUserMessage([])).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/resend.test.ts`
Expected: FAIL —— 模块 `../src/renderer/lib/resend` 不存在 / `lastUserMessage` 未定义。

- [ ] **Step 3: 写实现**

新建 `desktop/src/renderer/lib/resend.ts`：

```ts
import type { Item } from '../../shared/transcriptReducer'

/** 返回最后一条用户消息的 1-based ordinal 与文本;无用户消息返回 null。 */
export function lastUserMessage(items: Item[]): { ordinal: number; text: string } | null {
  let ordinal = 0
  let last: { ordinal: number; text: string } | null = null
  for (const item of items) {
    if (item.type === 'user') {
      ordinal++
      last = { ordinal, text: item.text }
    }
  }
  return last
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/resend.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 无 error（exit 0）。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/lib/resend.ts test/resend.test.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): lastUserMessage 纯函数(取最后一条用户消息 ordinal+text)

供失败横幅「重新发送」定位最后一条用户消息。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 2: 共享 rewindAndResubmit + 用户消息 hover「🔄 重新发送」

**Files:**
- Modify: `desktop/src/renderer/App.tsx`（抽 `rewindAndResubmit`、加 `handleResendMessage`、Transcript 传 `onResendMessage`）
- Modify: `desktop/src/renderer/components/Transcript.tsx`（`onResendMessage` prop + `isLastUser` 下传）
- Modify: `desktop/src/renderer/components/UserMessage.tsx`（`isLastUser`/`onResend` props + 🔄 按钮）

**Interfaces:**
- Consumes: 现有 `handleEditMessage` 逻辑体、`turnRef`、`fetchSessions`、`dispatch`、`setSubmitError`（App.tsx 内既有）。
- Produces:
  - `handleResendMessage(ordinal: number, text: string): void`（App.tsx）—— 供 Task 3 失败横幅复用。
  - `UserMessage` 新 props `isLastUser: boolean`、`onResend: (ordinal: number, text: string) => void`。
  - `Transcript` 新 prop `onResendMessage: (ordinal: number, text: string) => void`。

- [ ] **Step 1: App.tsx —— 抽 `rewindAndResubmit`，改写 `handleEditMessage`，加 `handleResendMessage`**

把现有 `handleEditMessage`（约 `src/renderer/App.tsx:484-510`）整块替换为下面三段：

```tsx
  // ── 消息编辑/重发/删除(真回溯:后端裁剪 → 本地裁剪 → 重发) ─────────────────
  const rewindAndResubmit = useCallback(
    async (ordinal: number, text: string) => {
      if (turnRef.current === 'running') return // 读即时快照,避免闭包陈旧漏放行
      setSubmitError(null) // 重发:清除上次遗留的错误横幅
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        dispatch({ type: 'addUserItem', text })
        void fetchSessions()
        // 与主 submit 路径对称:submitTurn 前即置 running,从源头关闭 submit→turn.started 竞态窗。
        dispatch({ type: 'markStarted' })
        await window.wraith.submitTurn(text)
      } catch (err) {
        console.error('[wraith] rewindAndResubmit error:', err)
        // 失败兜底:markStarted 已提前置 running,本地 RPC 失败时不会再有 turn.* 通知清 turn。
        dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
        const reason = err instanceof Error ? err.message : String(err)
        const short = reason.replace(/https?:\/\/\S+/g, '').replace(/sk-\S+/g, '').slice(0, 80).trim()
        setSubmitError(short ? `消息发送失败,请重试(${short})` : '消息发送失败,请重试')
      }
    },
    [fetchSessions], // running 守卫读 turnRef,不依赖 state.turn
  )

  const handleEditMessage = useCallback(
    (ordinal: number, newText: string) => { void rewindAndResubmit(ordinal, newText) },
    [rewindAndResubmit],
  )

  const handleResendMessage = useCallback(
    (ordinal: number, text: string) => { void rewindAndResubmit(ordinal, text) },
    [rewindAndResubmit],
  )
```

（`handleDeleteMessage` 保持不变。）

- [ ] **Step 2: App.tsx —— Transcript 传 `onResendMessage`**

把 Transcript 渲染块（约 `src/renderer/App.tsx:762-767`）：

```tsx
                <Transcript
                  items={state.items}
                  busy={state.turn === 'running'}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                />
```

改为（加一行 `onResendMessage`）：

```tsx
                <Transcript
                  items={state.items}
                  busy={state.turn === 'running'}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                  onResendMessage={handleResendMessage}
                />
```

- [ ] **Step 3: Transcript.tsx —— 加 prop + `isLastUser` 计算并下传**

在 `TranscriptProps` 接口（约 :9-15）的 `onDeleteMessage` 行后加一行：

```tsx
  onResendMessage: (ordinal: number, text: string) => void
```

把函数签名解构（:17）加上 `onResendMessage`：

```tsx
export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage }: TranscriptProps): JSX.Element {
```

在 `let userOrdinal = 0` 那行（:18）下方加总数计算：

```tsx
  const totalUsers = items.filter(i => i.type === 'user').length
```

把 `<UserMessage .../>`（:50-57）替换为（加 `isLastUser` 与 `onResend`）：

```tsx
            <UserMessage
              key={idx}
              text={item.text}
              ordinal={userOrdinal}
              isLastUser={userOrdinal === totalUsers}
              busy={busy}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              onResend={onResendMessage}
            />
```

- [ ] **Step 4: UserMessage.tsx —— 加 props + 🔄 按钮**

`UserMessageProps` 接口（:5-13）加两个字段：

```tsx
  /** 是否为最后一条用户消息:是则重发一键直发(重新生成),否则两击确认(丢弃其后内容)。 */
  isLastUser: boolean
  onResend: (ordinal: number, text: string) => void
```

函数解构（:16）加 `isLastUser, onResend`：

```tsx
export default function UserMessage({ text, ordinal, isLastUser, busy, onEdit, onDelete, onResend }: UserMessageProps): JSX.Element {
```

在 `const [confirming, setConfirming] = useState(false)`（:21）下方加：

```tsx
  const [resendConfirming, setResendConfirming] = useState(false)
```

在 hover 工具栏里，`data-testid="msg-edit"` 按钮与 `data-testid="msg-delete"` 按钮之间，插入 🔄 按钮：

```tsx
          <button
            data-testid="msg-resend"
            onClick={() => {
              if (isLastUser || resendConfirming) onResend(ordinal, text)
              else setResendConfirming(true)
            }}
            onBlur={() => setResendConfirming(false)}
            title={isLastUser ? '以原文本重新发送(重新生成回复)' : '丢弃此条之后的全部内容并以原文本重发'}
            className={
              'rounded-lg border px-2 py-1 text-2xs ' +
              (resendConfirming
                ? 'border-accent bg-accent/10 font-semibold text-accent'
                : 'border-border text-fg-muted hover:border-accent hover:text-accent')
            }
          >
            {resendConfirming ? '确认重发?' : '🔄 重新发送'}
          </button>
```

- [ ] **Step 5: typecheck + build + 全量 vitest 无回归**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected: typecheck exit 0；vitest 全绿（含 Task 1 的 resend 3 例 + 既有全部）；build 成功。

（本任务为 UI 接线，无独立单测——门禁为 typecheck + build + 既有 vitest 不回归，符合项目「组件无 RTL」约定。）

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/App.tsx src/renderer/components/Transcript.tsx src/renderer/components/UserMessage.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): 用户消息 hover「🔄 重新发送」+ 抽共享 rewindAndResubmit

三场景归一:抽 rewindAndResubmit(ordinal,text),edit/resend 都委托它。
最后一条一键直发(重新生成),较早消息两击确认(丢弃其后内容并重发)。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 3: 失败横幅「🔄 重新发送」

**Files:**
- Modify: `desktop/src/renderer/components/SubmitErrorBanner.tsx`（加可选 `onResend` prop + 按钮）
- Modify: `desktop/src/renderer/App.tsx`（import `lastUserMessage`；横幅传 `onResend`）

**Interfaces:**
- Consumes: Task 1 的 `lastUserMessage(items)`；Task 2 的 `handleResendMessage(ordinal, text)`；`state.items`、`setSubmitError`（App 内既有）。
- Produces: `SubmitErrorBanner` 新可选 prop `onResend?: () => void`。

- [ ] **Step 1: SubmitErrorBanner.tsx —— 加可选 prop + 按钮**

整文件替换为：

```tsx
interface SubmitErrorBannerProps {
  message: string
  onDismiss: () => void
  onResend?: () => void
}

export default function SubmitErrorBanner({ message, onDismiss, onResend }: SubmitErrorBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-xs" data-testid="submit-error">
      <span className="text-red-600 dark:text-red-400">✕ {message}</span>
      <span className="flex shrink-0 gap-2">
        {onResend && (
          <button
            data-testid="submit-error-resend"
            onClick={onResend}
            className="rounded-lg border border-red-500/60 px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            🔄 重新发送
          </button>
        )}
        <button
          data-testid="submit-error-dismiss"
          onClick={onDismiss}
          className="rounded-lg border border-red-500/60 px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-500/10"
        >
          知道了
        </button>
      </span>
    </div>
  )
}
```

- [ ] **Step 2: App.tsx —— import `lastUserMessage`**

在 App.tsx 顶部 import 区（与其它 `./lib/*` import 同处）加：

```tsx
import { lastUserMessage } from './lib/resend'
```

- [ ] **Step 3: App.tsx —— 横幅传 `onResend`**

把失败横幅渲染（约 `src/renderer/App.tsx:703-705`）：

```tsx
        {submitError && (
          <SubmitErrorBanner message={submitError} onDismiss={() => setSubmitError(null)} />
        )}
```

替换为：

```tsx
        {submitError && (() => {
          const lu = lastUserMessage(state.items)
          return (
            <SubmitErrorBanner
              message={submitError}
              onDismiss={() => setSubmitError(null)}
              onResend={lu ? () => handleResendMessage(lu.ordinal, lu.text) : undefined}
            />
          )
        })()}
```

（`handleResendMessage` 委托的 `rewindAndResubmit` 起手即 `setSubmitError(null)`，横幅会自然消失，无需重复清。）

- [ ] **Step 4: typecheck + build + 全量 vitest 无回归**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected: typecheck exit 0；vitest 全绿；build 成功。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/components/SubmitErrorBanner.tsx src/renderer/App.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): 失败横幅加「🔄 重新发送」—— 一键重试最后一条消息

发送失败横幅上加重发按钮,复用 handleResendMessage + lastUserMessage
定位最后一条用户消息;无用户消息时按钮不出现。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

## 交付后（计划外，人工/主循环执行）

1. 眼验（重启桌面 App 后）：① 最后一条 hover 🔄 → 一键重新生成回复；② 较早消息 🔄 → 两击「确认重发?」→ 丢弃其后并重发；③ 造发送失败 → 横幅 🔄 → 重试成功。
2. 验证通过 → `git checkout main && git merge --ff-only feat/resend-message && git push origin main`（推送前用户点头）→ 视情删分支。
（纯桌面改动，`~/.wraith/wraith.jar` 无需重建。）

## Self-Review

**1. Spec 覆盖：**
- 失败重试 → Task 3（横幅 🔄）。✓
- 原样一键重发 → Task 2（hover 🔄，最后一条一键 / 较早两击确认）。✓
- 重新生成回复 → Task 2（对最后一条一键重发 = 丢弃末回复重跑）。✓
- 共享 rewindAndResubmit（DRY）→ Task 2 Step 1。✓
- 纯函数 lastUserMessage + vitest → Task 1。✓
- 运行中禁用 → `rewindAndResubmit` 内 `turnRef` 守卫（Task 2）+ hover 工具栏 `!busy` 隐藏（既有）。✓
- 测试策略（纯函数 vitest + UI typecheck/build/眼验）→ 各任务 verify 步骤。✓

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整代码或精确前后文替换。✓

**3. 类型一致性：**
- `lastUserMessage(items: Item[]) → { ordinal; text } | null`：Task 1 定义，Task 3 消费一致（`lu.ordinal`/`lu.text`）。✓
- `handleResendMessage(ordinal, text)`：Task 2 定义，Task 3 消费一致。✓
- `UserMessage` props `isLastUser`/`onResend(ordinal, text)`：Task 2 内 Transcript 下传与 UserMessage 接收一致。✓
- `Transcript` prop `onResendMessage(ordinal, text)`：Task 2 App 传入与 Transcript 接收一致。✓
- `SubmitErrorBanner` `onResend?: () => void`：Task 3 定义与 App 传入一致（App 侧闭包 `() => handleResendMessage(...)` 匹配 `() => void`）。✓
