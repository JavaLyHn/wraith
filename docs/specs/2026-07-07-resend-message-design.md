# 设计：消息「重新发送」

日期：2026-07-07
范围：桌面渲染层（Electron/React）。**零后端改动、零新 RPC。**

## 背景 / 目标

聊天里用户消息现已有「✏️ 编辑 → 保存并重发」（丢弃此条及之后、以新文本重发）和「🗑 删除」（丢弃此条及之后、不重发）。缺一键「重新发送」。目标覆盖三个场景（经确认，均要）：

1. **失败重试**：发送失败（现仅弹横幅「消息发送失败,请重试(原因)」，输入框已清空）时，一键原样重发。
2. **原样一键重发**：任意已发用户消息，不进编辑框，一键以原文本重发。
3. **重新生成回复**：对最后一条用户消息原样重发（丢弃其后的 agent 回复→重跑→得新回复）。

关键洞察：三者是**同一操作**的三种入口/话术——「从第 N 条用户消息处回溯：丢弃第 N 条及之后，以该条原文本重新提交」。这正是现有 `handleEditMessage(ordinal, newText)` 的回溯+重发路径（`rewindSession → truncateAtUser → addUserItem → markStarted → submitTurn`）。重新发送 = 用**原文本**跑同一套。

## 非目标（YAGNI）

- 不改后端 / 不加 RPC / 不动 `turn.failed` 事件类型。
- 不做"编辑另存为新分支"、不做多版本对比。
- 不改 `rewindSession` / `truncateAtUserOrdinal` 的既有语义。

## 现有结构（复用锚点）

- `desktop/src/renderer/App.tsx`：
  - `handleEditMessage(ordinal, newText)`（:484）= 回溯+重发；`handleDeleteMessage(ordinal)`（:512）= 回溯不重发；均有 `turnRef.current==='running'` 守卫与 `turn.failed` 失败兜底。
  - `submitError` 状态（:138）+ `<SubmitErrorBanner message onDismiss>`（:703）。
- `desktop/src/renderer/components/UserMessage.tsx`：hover 工具栏（✏️编辑/🗑删除），`busy` 禁用，删除两击确认（`confirming` 态）。props：`text, ordinal, busy, onEdit, onDelete`。
- `desktop/src/renderer/components/Transcript.tsx`：渲染期用 `userOrdinal`（1-based）为用户气泡计数，传给 `UserMessage`。
- `desktop/src/renderer/components/SubmitErrorBanner.tsx`：`{message, onDismiss}`。
- `desktop/src/shared/transcriptReducer.ts`：`Item = {type:'user';text} | {type:'message';text} | thinking | tool`。用户消息判定 `type==='user'`，文本 `item.text`。

## 设计

### 1. 共享回溯原语（DRY）

从 `handleEditMessage` 抽出私有 `rewindAndResubmit(ordinal, text)`，内容为现 `handleEditMessage` try/catch 全体（`setSubmitError(null)` → `rewindSession` → `truncateAtUser` → `addUserItem(text)` → `markStarted` → `submitTurn(text)` + 失败兜底）。`handleEditMessage(ordinal, newText)` 与新增 `handleResendMessage(ordinal, text)` 都委托它。两者都保留 `turnRef.current==='running'` 守卫。行为对 edit 零变化（回归安全）。

### 2. 入口 1 — 用户消息 hover 工具栏「🔄 重新发送」

`UserMessage` 新增 prop `isLastUser: boolean` 与 `onResend: (ordinal, text) => void`。工具栏在 ✏️/🗑 之间（或旁）加「🔄 重新发送」按钮，`data-testid="msg-resend"`，`busy` 时同其它按钮一起隐藏：

- **`isLastUser === true`**：一键直发 → `onResend(ordinal, text)`。语义=重试/重新生成，仅丢弃最后一条回复，无意外损失。tooltip：「以原文本重新发送（重新生成回复）」。
- **`isLastUser === false`**：**两击确认**（复用删除的 `confirming` 模式，但独立状态位 `resendConfirming`，与删除的 `confirming` 互不干扰）。首击文案「确认重发?」，再击 → `onResend(ordinal, text)`；`onBlur` 复位。tooltip：「丢弃此条之后的全部内容并以原文本重发」。

`Transcript` 计算 `totalUsers = items.filter(i => i.type==='user').length`，对每个用户气泡传 `isLastUser={userOrdinal === totalUsers}`。

### 3. 入口 2 — 失败横幅「🔄 重新发送」

`SubmitErrorBanner` 增可选 prop `onResend?: () => void`。传入时，在「关闭」旁渲染「🔄 重新发送」按钮（`data-testid="submit-error-resend"`）。

`App` 计算最后一条用户消息 `lastUser = lastUserMessage(state.items)`（见下纯函数）。渲染横幅时，若 `lastUser` 存在则传 `onResend={() => { setSubmitError(null); handleResendMessage(lastUser.ordinal, lastUser.text) }}`；不存在则不传（按钮不出现）。覆盖本地 RPC 失败重试；后端轮次出错（`turn.failed`，如 LLM 报错文本落为 agent 消息）由入口 1 的 hover 重发覆盖。

### 4. 纯函数（可测）

新增 `desktop/src/renderer/lib/resend.ts`：
```ts
import type { Item } from '../../shared/transcriptReducer'
/** 返回最后一条用户消息的 1-based ordinal 与文本;无用户消息返回 null。 */
export function lastUserMessage(items: Item[]): { ordinal: number; text: string } | null
```
遍历 items，统计 `type==='user'` 的序号，记录最后一条的 ordinal 与 text。

## 错误处理

- 运行中（`turnRef==='running'`）所有重发入口禁用/早返回，与 edit/delete 一致。
- 重发自身失败：走 `rewindAndResubmit` 的既有失败兜底（`turn.failed` 归 idle + `setSubmitError`），与主 submit 完全对称——即失败后横幅再次出现，可再次重试。
- `lastUserMessage` 对空/无用户消息返回 null，横幅不出重发按钮。

## 测试

项目组件层无 RTL（既有约定：纯逻辑抽函数测 + typecheck/build/眼验）。

- **vitest**：`resend.test.ts` 覆盖 `lastUserMessage`——多条用户消息取最后一条（ordinal+text 正确）、夹杂 agent/thinking/tool 项不误算序号、空列表/无用户项返回 null。
- **typecheck + build**：UI 接线（新按钮、`isLastUser`/`resendConfirming` 分支、横幅 prop）。
- **眼验**：① 最后一条 hover 一键重发→重生成回复；② 较早消息重发→两击确认→丢弃其后并重发；③ 断网/造错触发横幅→点横幅「重新发送」→重试成功。

## 交付链路

新分支 `feat/resend-message`（off main `80ef066`）→ SDD 或 inline → typecheck + vitest + build 全绿 → 眼验 → FF-merge + 推送（推送前用户点头）。纯桌面改动，jar 不变。

## 安全

无密钥面。横幅 resend 复用现有 `submitError` 文案（已做 URL/sk- 脱敏 + 80 字截断）。提交前照例 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
