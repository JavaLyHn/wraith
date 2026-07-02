# Phase E-2 定时任务(Automations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端定时任务:Electron main 调度(30s tick/并发1/miss 可见),每次运行 spawn 独立 app-server 子进程,遇审批挂起等人(复用既有 ApprovalModal),结果=会话落盘+运行历史+系统通知+侧栏红点。

**Architecture:** 纯函数三件套(`computeNextRun` 调度心脏 / `automationsStore` 持久化 / `applyRunEvent` 运行状态机)承担全部可测逻辑;`AutomationRunner`(I/O 壳)与 `AutomationScheduler`(tick 壳)只做接线;renderer 整页 AutomationsPanel(E-1 版式)。**Java 后端零改动**(连续第三期)——后台任务就是一个标准 app-server 子进程。

**Tech Stack:** Electron main(child_process/Notification)/ React18+TS / vitest / Playwright。

**Spec:** `docs/specs/2026-07-02-desktop-phase-e2-automations.md`(需求真源;冲突以 spec 为准)

## Global Constraints

- **Java/协议零改动**:src/main/java 一行不动;合并前全量回归 3F/38E 基线(总数随分支无 Java 新增应持平 939)。
- 执行分支 `feat/desktop-phase-e2`(从 main 切出)。
- **主会话链路零触碰**:`client/currentSessionId/currentTurnId`、交互审批槽(`state.pendingApproval`)不与自动化混用;自动化审批走独立 push channel `wraith:automation-event` 与 App 独立 state 槽。
- 审批不降级:后台任务 ask 模式(不调 session.setApprovalMode);挂起无限期,面板可终止。
- 已钉死的 wire 事实(侦察完成,不得偏离):助手正文 = `message.delta` params `{text}` 与 `message.end`;`approval.requested` params = base + `approvalId/toolName/argsJson/dangerLevel/riskDescription/suggestion/beforeContent`;`turn.completed` params 携带 `sessionId`;`resolveBackendCommand(env, defaultJar)` 尊重 `WRAITH_APPSERVER_CMD`。
- 调度语义(spec §4 逐字):interval 锚 = `lastFiredAt ?? enabledAt`;daily/weekly 边界「时刻 >= now 判未过(恰等即触发)」;miss 也更新 lastFiredAt;**立即运行不更新 lastFiredAt**;排队中同任务再次到点不重复入队(记 miss);并发全局=1。
- E2E 新用例必须 `WRAITH_E2E_USERDATA` 临时目录;无 sleep;临时文件全清理。desktop 基线:vitest 115、Playwright 32、tsc 0,不得回归。
- desktop 命令在 `/Users/aa00945/Desktop/wraith/desktop` 下执行(每次 Bash 先 cd)。
- 密钥红线:提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`;commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 共享类型 + automationsStore(TDD)

**Files:**
- Modify: `desktop/src/shared/types.ts`(追加)
- Create: `desktop/src/main/automationsStore.ts`
- Test: `desktop/test/automationsStore.test.ts`(新)

**Interfaces:**
- Produces(全计划的数据契约,逐字):

```ts
// shared/types.ts 追加:
export type AutomationSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }                     // 'HH:mm' 本地时区
  | { kind: 'weekly'; weekday: number; time: string }   // 0-6,周日=0

export interface AutomationTask {
  id: string
  name: string
  prompt: string
  projectPath: string
  schedule: AutomationSchedule
  enabled: boolean
  createdAt: number
  /** enabled 置 true 的时刻(interval 锚点;创建即启用时=createdAt) */
  enabledAt: number
  lastFiredAt: number | null
}

export type AutomationRunStatus = 'running' | 'waiting_approval' | 'success' | 'failed' | 'interrupted'

export interface AutomationRun {
  runId: string
  taskId: string
  startedAt: number
  endedAt?: number
  status: AutomationRunStatus
  sessionId?: string
  summary?: string
  miss?: boolean
}

export type AutomationEvent =
  | { kind: 'runs-changed' }
  | { kind: 'badge'; show: boolean }
  | { kind: 'approval'; runId: string; payload: Record<string, unknown> }
  | { kind: 'open-panel' }
```

- `automationsStore.ts` 纯函数(全部注入 `userDataDir`;时间由调用方注入):
  - `readTasks(dir): AutomationTask[]` / `upsertTask(dir, task): void` / `removeTask(dir, id): void`(连带删该任务 runs)
  - `readRuns(dir): AutomationRun[]` / `putRun(dir, run): void`(按 runId upsert;写后**每任务**裁剪至最近 50 条,按 startedAt 倒序保留)
  - `readLastPanelOpenedAt(dir): number` / `writeLastPanelOpenedAt(dir, ts): void`
  - `badgeVisible(runs, lastPanelOpenedAt): boolean` = 存在 `waiting_approval`,或存在 `endedAt > lastPanelOpenedAt` 的终态 run
  - 文件:`automations.json`(`{tasks:[...]}`)、`runs.json`(`{runs:[...], lastPanelOpenedAt?:number}`);坏 JSON → 按空 + 不崩(settings.ts 同款 try/catch)

- [ ] **Step 1: 写失败测试**(`desktop/test/automationsStore.test.ts`;@TempDir 手法与 settings.test.ts 同款:mkdtempSync/rmSync)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readTasks, upsertTask, removeTask,
  readRuns, putRun,
  readLastPanelOpenedAt, writeLastPanelOpenedAt, badgeVisible,
} from '../src/main/automationsStore'
import type { AutomationTask, AutomationRun } from '../src/shared/types'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-auto-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function task(id: string, over: Partial<AutomationTask> = {}): AutomationTask {
  return { id, name: 'n' + id, prompt: 'p', projectPath: '/proj', enabled: true,
    schedule: { kind: 'interval', everyMinutes: 10 }, createdAt: 1000, enabledAt: 1000, lastFiredAt: null, ...over }
}
function run(runId: string, taskId: string, over: Partial<AutomationRun> = {}): AutomationRun {
  return { runId, taskId, startedAt: 1000, status: 'success', endedAt: 2000, ...over }
}

describe('automationsStore', () => {
  it('tasks: upsert 去重(按 id)与读回', () => {
    upsertTask(dir, task('a'))
    upsertTask(dir, task('a', { name: '改名' }))
    upsertTask(dir, task('b'))
    const ts = readTasks(dir)
    expect(ts.map(t => t.id)).toEqual(['a', 'b'])
    expect(ts[0]!.name).toBe('改名')
  })

  it('removeTask 连带删除该任务 runs,他任务不受影响', () => {
    upsertTask(dir, task('a')); upsertTask(dir, task('b'))
    putRun(dir, run('r1', 'a')); putRun(dir, run('r2', 'b'))
    removeTask(dir, 'a')
    expect(readTasks(dir).map(t => t.id)).toEqual(['b'])
    expect(readRuns(dir).map(r => r.runId)).toEqual(['r2'])
  })

  it('putRun 按 runId upsert(状态迁移覆盖同条)', () => {
    putRun(dir, run('r1', 'a', { status: 'running', endedAt: undefined }))
    putRun(dir, run('r1', 'a', { status: 'success', endedAt: 5000 }))
    const rs = readRuns(dir)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.status).toBe('success')
  })

  it('每任务裁剪至最近 50 条(按 startedAt 倒序保留)', () => {
    for (let i = 0; i < 55; i++) putRun(dir, run('r' + i, 'a', { startedAt: i }))
    putRun(dir, run('other', 'b', { startedAt: 1 }))
    const rs = readRuns(dir)
    expect(rs.filter(r => r.taskId === 'a')).toHaveLength(50)
    expect(rs.filter(r => r.taskId === 'a').every(r => r.startedAt >= 5)).toBe(true)
    expect(rs.filter(r => r.taskId === 'b')).toHaveLength(1)
  })

  it('badgeVisible:waiting_approval 或 终态晚于上次打开', () => {
    const waiting = [run('r1', 'a', { status: 'waiting_approval', endedAt: undefined })]
    expect(badgeVisible(waiting, 9999)).toBe(true)
    const done = [run('r1', 'a', { status: 'success', endedAt: 500 })]
    expect(badgeVisible(done, 100)).toBe(true)
    expect(badgeVisible(done, 600)).toBe(false)
    expect(badgeVisible([run('r1', 'a', { status: 'running', endedAt: undefined })], 0)).toBe(false)
  })

  it('lastPanelOpenedAt 读写往返,缺省 0', () => {
    expect(readLastPanelOpenedAt(dir)).toBe(0)
    writeLastPanelOpenedAt(dir, 777)
    expect(readLastPanelOpenedAt(dir)).toBe(777)
  })

  it('坏 JSON 按空处理不崩', () => {
    fs.writeFileSync(path.join(dir, 'automations.json'), 'not json', 'utf8')
    fs.writeFileSync(path.join(dir, 'runs.json'), '[broken', 'utf8')
    expect(readTasks(dir)).toEqual([])
    expect(readRuns(dir)).toEqual([])
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/automationsStore.test.ts`。Expected: 模块不存在。

- [ ] **Step 3: 实现 `automationsStore.ts`**

```ts
import fs from 'fs'
import path from 'path'
import type { AutomationTask, AutomationRun } from '../shared/types'

/** 每任务运行记录保留上限(spec §3)。 */
const RUNS_PER_TASK = 50

interface TasksFile { tasks?: AutomationTask[] }
interface RunsFile { runs?: AutomationRun[]; lastPanelOpenedAt?: number }

function tasksPath(dir: string): string { return path.join(dir, 'automations.json') }
function runsPath(dir: string): string { return path.join(dir, 'runs.json') }

function readJson<T>(file: string): T | null {
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return obj && typeof obj === 'object' ? (obj as T) : null
  } catch {
    return null // 缺失/坏 JSON → 按空(settings.ts 同款容错)
  }
}
function writeJson(file: string, obj: unknown): void {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8') }
  catch { /* best-effort:持久化失败不崩 app */ }
}

export function readTasks(dir: string): AutomationTask[] {
  return readJson<TasksFile>(tasksPath(dir))?.tasks ?? []
}

export function upsertTask(dir: string, t: AutomationTask): void {
  const tasks = readTasks(dir)
  const i = tasks.findIndex(x => x.id === t.id)
  if (i >= 0) tasks[i] = t; else tasks.push(t)
  writeJson(tasksPath(dir), { tasks })
}

export function removeTask(dir: string, id: string): void {
  writeJson(tasksPath(dir), { tasks: readTasks(dir).filter(t => t.id !== id) })
  const f = readJson<RunsFile>(runsPath(dir)) ?? {}
  writeJson(runsPath(dir), { ...f, runs: (f.runs ?? []).filter(r => r.taskId !== id) })
}

export function readRuns(dir: string): AutomationRun[] {
  return readJson<RunsFile>(runsPath(dir))?.runs ?? []
}

/** 按 runId upsert;写后每任务按 startedAt 倒序裁剪至 RUNS_PER_TASK。 */
export function putRun(dir: string, run: AutomationRun): void {
  const f = readJson<RunsFile>(runsPath(dir)) ?? {}
  const runs = (f.runs ?? []).filter(r => r.runId !== run.runId)
  runs.push(run)
  const byTask = new Map<string, AutomationRun[]>()
  for (const r of runs) {
    const list = byTask.get(r.taskId) ?? []
    list.push(r)
    byTask.set(r.taskId, list)
  }
  const trimmed: AutomationRun[] = []
  for (const list of byTask.values()) {
    list.sort((a, b) => b.startedAt - a.startedAt)
    trimmed.push(...list.slice(0, RUNS_PER_TASK))
  }
  writeJson(runsPath(dir), { ...f, runs: trimmed })
}

export function readLastPanelOpenedAt(dir: string): number {
  return readJson<RunsFile>(runsPath(dir))?.lastPanelOpenedAt ?? 0
}

export function writeLastPanelOpenedAt(dir: string, ts: number): void {
  const f = readJson<RunsFile>(runsPath(dir)) ?? {}
  writeJson(runsPath(dir), { ...f, lastPanelOpenedAt: ts })
}

/** 红点:有挂起审批,或有终态运行晚于上次打开面板(spec §1.1-6)。 */
export function badgeVisible(runs: AutomationRun[], lastPanelOpenedAt: number): boolean {
  return runs.some(r => r.status === 'waiting_approval')
      || runs.some(r => r.endedAt !== undefined && r.endedAt > lastPanelOpenedAt)
}
```

(shared/types.ts 追加按 Produces 逐字。)

- [ ] **Step 4: 确认通过 + 全量** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run 2>&1 | tail -2`。Expected: 122(115+7)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/main/automationsStore.ts desktop/test/automationsStore.test.ts
git commit -m "feat(desktop): 自动化任务/运行存储纯函数(裁剪50/红点判定/坏JSON容错)"
```

---

### Task 2: computeNextRun(调度心脏,TDD)

**Files:**
- Create: `desktop/src/main/automationSchedule.ts`
- Test: `desktop/test/automationSchedule.test.ts`(新)

**Interfaces:**
- Produces:`computeNextRun(schedule: AutomationSchedule, now: number, lastFiredAt: number | null, enabledAt: number): number`(返回下一次应触发的 epoch ms;可能 <= now,调用方以 `now >= 返回值` 判到点)。本地时区;DST 不特殊处理(spec 声明)。

- [ ] **Step 1: 写失败测试**(用 `new Date(y, m, d, h, min)` 本地构造,跨时区确定)

```ts
import { describe, it, expect } from 'vitest'
import { computeNextRun } from '../src/main/automationSchedule'

const T = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('computeNextRun', () => {
  it('interval:锚 = lastFiredAt ?? enabledAt', () => {
    const s = { kind: 'interval', everyMinutes: 30 } as const
    expect(computeNextRun(s, T(2026, 7, 2, 10, 0), null, T(2026, 7, 2, 9, 0))).toBe(T(2026, 7, 2, 9, 30))
    expect(computeNextRun(s, T(2026, 7, 2, 10, 0), T(2026, 7, 2, 9, 50), T(2026, 7, 2, 9, 0))).toBe(T(2026, 7, 2, 10, 20))
  })

  it('daily:今天时刻未过(含恰等)取今天,已过取明天', () => {
    const s = { kind: 'daily', time: '14:30' } as const
    expect(computeNextRun(s, T(2026, 7, 2, 10, 0), null, 0)).toBe(T(2026, 7, 2, 14, 30))
    expect(computeNextRun(s, T(2026, 7, 2, 14, 30), null, 0)).toBe(T(2026, 7, 2, 14, 30)) // 恰等=未过
    expect(computeNextRun(s, T(2026, 7, 2, 15, 0), null, 0)).toBe(T(2026, 7, 3, 14, 30))
  })

  it('weekly:本周该天时刻未过取本周,已过取下周', () => {
    // 2026-07-02 是周四(weekday 4)
    const s = { kind: 'weekly', weekday: 4, time: '09:00' } as const
    expect(computeNextRun(s, T(2026, 7, 2, 8, 0), null, 0)).toBe(T(2026, 7, 2, 9, 0))
    expect(computeNextRun(s, T(2026, 7, 2, 10, 0), null, 0)).toBe(T(2026, 7, 9, 9, 0))
    const sun = { kind: 'weekly', weekday: 0, time: '12:00' } as const // 周日=0
    expect(computeNextRun(sun, T(2026, 7, 2, 10, 0), null, 0)).toBe(T(2026, 7, 5, 12, 0))
  })

  it('daily/weekly 触发后(lastFiredAt=当日该时刻)下一次跳到下个周期', () => {
    const d = { kind: 'daily', time: '14:30' } as const
    expect(computeNextRun(d, T(2026, 7, 2, 14, 31), T(2026, 7, 2, 14, 30), 0)).toBe(T(2026, 7, 3, 14, 30))
    const w = { kind: 'weekly', weekday: 4, time: '09:00' } as const
    expect(computeNextRun(w, T(2026, 7, 2, 9, 1), T(2026, 7, 2, 9, 0), 0)).toBe(T(2026, 7, 9, 9, 0))
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/automationSchedule.test.ts`(desktop 下)。Expected: 模块不存在。

- [ ] **Step 3: 实现**

```ts
import type { AutomationSchedule } from '../shared/types'

/** 下一次应触发时刻(epoch ms;可 <= now,调用方以 now>=值 判到点)。本地时区;DST 不特殊处理(spec §4)。 */
export function computeNextRun(
  schedule: AutomationSchedule, now: number, lastFiredAt: number | null, enabledAt: number,
): number {
  if (schedule.kind === 'interval') {
    return (lastFiredAt ?? enabledAt) + schedule.everyMinutes * 60_000
  }
  const [h, mi] = schedule.time.split(':').map(Number) as [number, number]
  const base = new Date(now)
  const at = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime()
  if (schedule.kind === 'daily') {
    let t = at(base)
    // 边界:恰等 now 判未过(spec);但若本时刻已触发过(lastFiredAt>=t)则跳明天
    if (t < now || (lastFiredAt !== null && lastFiredAt >= t)) t += 24 * 3_600_000
    return t
  }
  // weekly
  const day = new Date(now)
  const delta = (schedule.weekday - day.getDay() + 7) % 7
  day.setDate(day.getDate() + delta)
  let t = at(day)
  if (t < now || (lastFiredAt !== null && lastFiredAt >= t)) t += 7 * 24 * 3_600_000
  return t
}
```

- [ ] **Step 4: 确认通过** — Run: `npx vitest run test/automationSchedule.test.ts`。Expected: 4/4。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/automationSchedule.ts desktop/test/automationSchedule.test.ts
git commit -m "feat(desktop): computeNextRun 三档调度纯函数(锚点/边界/触发后跳周期)"
```

---

### Task 3: applyRunEvent 运行状态机(TDD)

**Files:**
- Create: `desktop/src/main/automationRunState.ts`
- Test: `desktop/test/automationRunState.test.ts`(新)

**Interfaces:**
- Produces(Task 4 依赖,逐字):

```ts
export interface RunState {
  phase: 'starting' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'interrupted'
  summaryBuf: string
  lastMessage: string
  approval: { approvalId: string; payload: Record<string, unknown> } | null
  sessionId?: string
  error?: string
}
export type RunEvent =
  | { type: 'turn-submitted' }
  | { type: 'notification'; method: string; params: Record<string, unknown> }
  | { type: 'approval-responded' }
  | { type: 'child-exit' }          // 意外退出(未 kill)
  | { type: 'stopped' }             // main 主动终止
export function initialRunState(): RunState
export function applyRunEvent(s: RunState, e: RunEvent): RunState
export function summaryOf(s: RunState): string   // lastMessage(或未定稿的 summaryBuf)首 120 字,单行化
```

- 语义:`message.delta` 累积 `summaryBuf`;`message.end` → `lastMessage=summaryBuf` 且清空 buf;
  `approval.requested` → phase=waiting_approval + 存 approval;`approval-responded` → 回 running 清 approval;
  `turn.completed` → success + sessionId(params.sessionId);`turn.failed` → failed(error=params.error 若有);
  终态后一切事件忽略(幂等);`child-exit` 在非终态 → failed('子进程意外退出');`stopped` → interrupted。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { initialRunState, applyRunEvent, summaryOf, type RunEvent } from '../src/main/automationRunState'

const n = (method: string, params: Record<string, unknown> = {}): RunEvent =>
  ({ type: 'notification', method, params })

function play(events: RunEvent[]) {
  return events.reduce(applyRunEvent, initialRunState())
}

describe('applyRunEvent', () => {
  it('正常完成:delta 聚合→end 定稿→completed 带 sessionId', () => {
    const s = play([
      { type: 'turn-submitted' },
      n('message.delta', { text: '你好,' }), n('message.delta', { text: '世界' }),
      n('message.end'),
      n('turn.completed', { sessionId: 'sess_9' }),
    ])
    expect(s.phase).toBe('success')
    expect(s.sessionId).toBe('sess_9')
    expect(summaryOf(s)).toBe('你好,世界')
  })

  it('多条消息取最后一条定稿的', () => {
    const s = play([
      { type: 'turn-submitted' },
      n('message.delta', { text: '第一段' }), n('message.end'),
      n('message.delta', { text: '最终结论' }), n('message.end'),
      n('turn.completed', { sessionId: 'x' }),
    ])
    expect(summaryOf(s)).toBe('最终结论')
  })

  it('审批挂起与恢复', () => {
    const mid = play([
      { type: 'turn-submitted' },
      n('approval.requested', { approvalId: 'ap1', toolName: 'execute_command' }),
    ])
    expect(mid.phase).toBe('waiting_approval')
    expect(mid.approval?.approvalId).toBe('ap1')
    const resumed = applyRunEvent(mid, { type: 'approval-responded' })
    expect(resumed.phase).toBe('running')
    expect(resumed.approval).toBeNull()
  })

  it('turn.failed / child-exit / stopped 各归其态;终态幂等', () => {
    expect(play([{ type: 'turn-submitted' }, n('turn.failed', { error: 'boom' })]).phase).toBe('failed')
    expect(play([{ type: 'turn-submitted' }, { type: 'child-exit' }]).phase).toBe('failed')
    expect(play([{ type: 'turn-submitted' }, { type: 'stopped' }]).phase).toBe('interrupted')
    const done = play([{ type: 'turn-submitted' }, n('turn.completed', { sessionId: 'x' })])
    expect(applyRunEvent(done, { type: 'child-exit' }).phase).toBe('success') // 终态不动
  })

  it('summaryOf:未定稿用 buf;截 120 字并单行化', () => {
    const s = play([{ type: 'turn-submitted' }, n('message.delta', { text: 'A\nB'.padEnd(200, 'x') })])
    expect(summaryOf(s).length).toBe(120)
    expect(summaryOf(s)).not.toContain('\n')
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/automationRunState.test.ts`。Expected: 模块不存在。

- [ ] **Step 3: 实现**

```ts
const TERMINAL = new Set(['success', 'failed', 'interrupted'])

export function initialRunState(): RunState {
  return { phase: 'starting', summaryBuf: '', lastMessage: '', approval: null }
}

export function applyRunEvent(s: RunState, e: RunEvent): RunState {
  if (TERMINAL.has(s.phase)) return s
  switch (e.type) {
    case 'turn-submitted':
      return { ...s, phase: 'running' }
    case 'approval-responded':
      return { ...s, phase: 'running', approval: null }
    case 'child-exit':
      return { ...s, phase: 'failed', error: '子进程意外退出' }
    case 'stopped':
      return { ...s, phase: 'interrupted' }
    case 'notification': {
      const p = e.params
      switch (e.method) {
        case 'message.delta':
          return { ...s, summaryBuf: s.summaryBuf + String(p['text'] ?? '') }
        case 'message.end':
          return { ...s, lastMessage: s.summaryBuf, summaryBuf: '' }
        case 'approval.requested':
          return { ...s, phase: 'waiting_approval', approval: { approvalId: String(p['approvalId']), payload: p } }
        case 'turn.completed':
          return { ...s, phase: 'success', sessionId: p['sessionId'] != null ? String(p['sessionId']) : undefined }
        case 'turn.failed':
          return { ...s, phase: 'failed', error: p['error'] != null ? String(p['error']) : undefined }
        default:
          return s
      }
    }
  }
}

export function summaryOf(s: RunState): string {
  const text = s.lastMessage || s.summaryBuf
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}
```

(interface/type 定义与 Produces 逐字;文件顶部导出。)

- [ ] **Step 4: 确认通过** — Run: `npx vitest run test/automationRunState.test.ts`。Expected: 5/5。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/automationRunState.ts desktop/test/automationRunState.test.ts
git commit -m "feat(desktop): 自动化运行状态机纯函数(聚合摘要/挂起恢复/终态幂等)"
```

---

### Task 4: AutomationRunner(I/O 壳)

**Files:**
- Create: `desktop/src/main/automationRunner.ts`

**Interfaces:**
- Consumes: Task 3 状态机;既有 `resolveBackendCommand/defaultJarPath`(backend.ts)、`JsonRpcClient`(shared/jsonRpcClient:`constructor(writeLine)/request/handleLine/onNotification/rejectAll`)。
- Produces(Task 5/6 依赖,逐字):

```ts
export interface RunnerCallbacks {
  onUpdate(state: RunState): void                        // 每次状态变化(含摘要增量后的终态)
  onApproval(approvalId: string, payload: Record<string, unknown>): void
}
export class AutomationRunner {
  constructor(env: NodeJS.ProcessEnv, homedir: string, cb: RunnerCallbacks)
  /** 启动一次运行;resolve 于终态(不 reject——失败也是终态)。 */
  run(projectPath: string, prompt: string): Promise<RunState>
  /** 尽力 turn.interrupt 后 kill;状态机收 'stopped'。 */
  stop(): void
  respondApproval(approvalId: string, decision: string, opts: { modifiedArgs?: string; allowNetwork?: boolean } | null): void
}
```

- [ ] **Step 1: 实现**(无独立单测——全部决策逻辑已在 Task 3 状态机;本壳由 Task 8 E2E 全链路覆盖。门禁 = tsc + vitest 回归)

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import { initialRunState, applyRunEvent, type RunState, type RunEvent } from './automationRunState'

const INIT_TIMEOUT_MS = 30_000

/** 一次自动化运行的独立后台 app-server 子进程(spec §5)。主会话链路零触碰。 */
export class AutomationRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: JsonRpcClient | null = null
  private state: RunState = initialRunState()
  private sessionId: string | null = null
  private turnId: string | null = null
  private stopping = false
  private settle: ((s: RunState) => void) | null = null

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly homedir: string,
    private readonly cb: RunnerCallbacks,
  ) {}

  run(projectPath: string, prompt: string): Promise<RunState> {
    return new Promise<RunState>(resolve => {
      this.settle = resolve
      const { cmd, args } = resolveBackendCommand(this.env, defaultJarPath(this.homedir))
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
      this.child = proc
      const client = new JsonRpcClient(line => {
        if (!proc.killed && proc.stdin.writable) proc.stdin.write(line + '\n')
      })
      this.client = client
      readline.createInterface({ input: proc.stdout }).on('line', l => client.handleLine(l))
      proc.stderr.on('data', (c: Buffer) => process.stderr.write(`[automation] ${c}`))
      proc.on('exit', () => this.dispatch({ type: this.stopping ? 'stopped' : 'child-exit' }))
      proc.on('error', () => this.dispatch({ type: 'child-exit' }))

      client.onNotification((method, params) => {
        const p = (params ?? {}) as Record<string, unknown>
        this.dispatch({ type: 'notification', method, params: p })
        if (method === 'approval.requested') {
          this.cb.onApproval(String(p['approvalId']), p)
        }
        if (method === 'turn.completed' || method === 'turn.failed') {
          this.killChild() // 终态即回收子进程
        }
      })

      void (async () => {
        try {
          const to = setTimeout(() => { this.failEarly('initialize 超时'); }, INIT_TIMEOUT_MS)
          await client.request('initialize', { clientInfo: 'wraith-automation' })
          const started = await client.request('session.start', { workspaceDir: projectPath }) as { sessionId: string }
          clearTimeout(to)
          this.sessionId = started.sessionId
          const turn = await client.request('turn.submit', { sessionId: started.sessionId, input: prompt }) as { turnId: string }
          this.turnId = turn.turnId
          this.dispatch({ type: 'turn-submitted' })
        } catch (err) {
          this.failEarly(String(err))
        }
      })()
    })
  }

  stop(): void {
    this.stopping = true
    const c = this.client
    if (c && this.sessionId && this.turnId) {
      void c.request('turn.interrupt', { sessionId: this.sessionId, turnId: this.turnId }).catch(() => { /* 尽力 */ })
    }
    setTimeout(() => this.killChild(), 500) // 给 interrupt 半秒,随后强杀;exit 回调补 'stopped'
  }

  respondApproval(approvalId: string, decision: string, opts: { modifiedArgs?: string; allowNetwork?: boolean } | null): void {
    const c = this.client
    if (!c) return
    void c.request('approval.respond', {
      approvalId, decision,
      ...(opts?.modifiedArgs ? { modifiedArgs: opts.modifiedArgs } : {}),
      ...(opts?.allowNetwork ? { allowNetwork: true } : {}),
    }).then(() => this.dispatch({ type: 'approval-responded' }))
      .catch(() => { /* 子进程已死:exit 回调兜底 */ })
  }

  private dispatch(e: RunEvent): void {
    const prev = this.state
    this.state = applyRunEvent(prev, e)
    if (this.state !== prev) {
      this.cb.onUpdate(this.state)
      const terminal = this.state.phase === 'success' || this.state.phase === 'failed' || this.state.phase === 'interrupted'
      if (terminal && this.settle) {
        const s = this.settle
        this.settle = null
        this.killChild()
        s(this.state)
      }
    }
  }

  private failEarly(msg: string): void {
    // spawn/initialize 阶段失败:走 turn.failed 语义进终态
    this.dispatch({ type: 'notification', method: 'turn.failed', params: { error: msg } })
    this.killChild()
  }

  private killChild(): void {
    try { this.child?.kill() } catch { /* 已死 */ }
    this.client?.rejectAll('automation run ended')
  }
}
```

(import type `RunnerCallbacks` 定义于本文件并导出,逐字见 Produces。)

- [ ] **Step 2: 门禁** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2`。Expected: tsc 0、vitest 131(115 基线 +7 Task1 +4 Task2 +5 Task3,本任务无新测)。

- [ ] **Step 3: Commit**

```bash
git add desktop/src/main/automationRunner.ts
git commit -m "feat(desktop): AutomationRunner 后台子进程运行壳(协议驱动/审批转发/终止回收)"
```

---

### Task 5: AutomationScheduler(tick 壳 + 纯决策函数,TDD)

**Files:**
- Create: `desktop/src/main/automationScheduler.ts`
- Test: `desktop/test/automationScheduler.test.ts`(新,只测纯决策函数)

**Interfaces:**
- Consumes: Task 1 store、Task 2 computeNextRun、Task 4 Runner。
- Produces(Task 6 依赖):

```ts
/** 纯决策:本 tick 该做什么。queue/runningTaskId 由壳持有传入。 */
export interface TickDecision { fire: string[]; enqueue: string[]; miss: string[] }
export function decideTick(
  tasks: AutomationTask[], now: number,
  runningTaskId: string | null, queuedTaskIds: string[],
  activeTaskIds: Set<string>,           // 有 running/waiting_approval run 的任务
): TickDecision

export class AutomationScheduler {
  constructor(deps: {
    userDataDir: string
    env: NodeJS.ProcessEnv
    homedir: string
    onRunsChanged(): void
    onApproval(runId: string, payload: Record<string, unknown>): void
    onTerminal(run: AutomationRun): void       // 终态:main 发通知用
  })
  start(): void                                 // 30s tick
  stopAll(): void                               // will-quit:kill 全部,running/waiting 落 interrupted
  runNow(taskId: string): { ok: boolean }       // 手动触发(不更新 lastFiredAt)
  stopRun(runId: string): { ok: boolean }
  respondApproval(runId: string, approvalId: string, decision: string, opts: { modifiedArgs?: string; allowNetwork?: boolean } | null): { ok: boolean }
}
```

- 决策语义(spec §4 逐字):enabled 任务 `now >= computeNextRun(...)` 即到点;到点时——
  该任务 active → miss;全局有 running(runningTaskId 非空)→ 入 enqueue(已在 queue → miss);
  否则 fire(本 tick 至多 fire 1 个,其余到点者 enqueue)。fire/miss 均由壳更新 lastFiredAt=now;
  enqueue 不更新(出队执行时更)。

- [ ] **Step 1: 写失败测试**(只测 decideTick)

```ts
import { describe, it, expect } from 'vitest'
import { decideTick } from '../src/main/automationScheduler'
import type { AutomationTask } from '../src/shared/types'

function t(id: string, over: Partial<AutomationTask> = {}): AutomationTask {
  return { id, name: id, prompt: 'p', projectPath: '/p', enabled: true,
    schedule: { kind: 'interval', everyMinutes: 10 }, createdAt: 0, enabledAt: 0, lastFiredAt: null, ...over }
}
const MIN = 60_000

describe('decideTick', () => {
  it('到点且空闲 → fire 一个,其余到点者排队', () => {
    const d = decideTick([t('a'), t('b')], 11 * MIN, null, [], new Set())
    expect(d.fire).toEqual(['a'])
    expect(d.enqueue).toEqual(['b'])
    expect(d.miss).toEqual([])
  })

  it('未到点不动;disabled 不动', () => {
    const d = decideTick([t('a', { lastFiredAt: 5 * MIN }), t('b', { enabled: false })], 11 * MIN, null, [], new Set())
    expect(d).toEqual({ fire: [], enqueue: [], miss: [] })
  })

  it('全局有运行中 → 到点者排队;已在队列 → miss', () => {
    const d = decideTick([t('a'), t('b')], 11 * MIN, 'other', ['b'], new Set())
    expect(d.fire).toEqual([])
    expect(d.enqueue).toEqual(['a'])
    expect(d.miss).toEqual(['b'])
  })

  it('同任务 active(running/waiting) → miss 不触发', () => {
    const d = decideTick([t('a')], 11 * MIN, null, [], new Set(['a']))
    expect(d.miss).toEqual(['a'])
    expect(d.fire).toEqual([])
  })
})
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/automationScheduler.test.ts`。Expected: 模块不存在。

- [ ] **Step 3: 实现**(decideTick + 壳;壳的行为由 E2E「立即运行」链覆盖)

```ts
import fs from 'fs'
import os from 'os'
import { randomUUID } from 'crypto'
import type { AutomationTask, AutomationRun } from '../shared/types'
import { computeNextRun } from './automationSchedule'
import { readTasks, upsertTask, readRuns, putRun } from './automationsStore'
import { AutomationRunner } from './automationRunner'
import { summaryOf, type RunState } from './automationRunState'

const TICK_MS = 30_000

export function decideTick(
  tasks: AutomationTask[], now: number,
  runningTaskId: string | null, queuedTaskIds: string[],
  activeTaskIds: Set<string>,
): TickDecision {
  const d: TickDecision = { fire: [], enqueue: [], miss: [] }
  for (const task of tasks) {
    if (!task.enabled) continue
    if (now < computeNextRun(task.schedule, now, task.lastFiredAt, task.enabledAt)) continue
    if (activeTaskIds.has(task.id)) { d.miss.push(task.id); continue }
    if (queuedTaskIds.includes(task.id)) { d.miss.push(task.id); continue }
    if (runningTaskId !== null || d.fire.length > 0) { d.enqueue.push(task.id); continue }
    d.fire.push(task.id)
  }
  return d
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null
  private queue: string[] = []
  private current: { runId: string; taskId: string; runner: AutomationRunner } | null = null

  constructor(private readonly deps: {
    userDataDir: string
    env: NodeJS.ProcessEnv
    homedir: string
    onRunsChanged(): void
    onApproval(runId: string, payload: Record<string, unknown>): void
    onTerminal(run: AutomationRun): void
  }) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(Date.now()), TICK_MS)
  }

  stopAll(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    const cur = this.current
    if (cur) {
      cur.runner.stop()
      this.finishRun(cur.runId, cur.taskId, { phase: 'interrupted' } as RunState)
    }
    this.queue = []
  }

  runNow(taskId: string): { ok: boolean } {
    const task = readTasks(this.deps.userDataDir).find(t => t.id === taskId)
    if (!task) return { ok: false }
    if (this.activeTaskIds().has(taskId) || this.queue.includes(taskId)) return { ok: false }
    if (this.current) { this.queue.push(taskId); return { ok: true } }
    this.fire(task, /* updateLastFired */ false)   // 立即运行不更新 lastFiredAt(spec §4)
    return { ok: true }
  }

  stopRun(runId: string): { ok: boolean } {
    if (this.current?.runId !== runId) return { ok: false }
    this.current.runner.stop()
    return { ok: true }
  }

  respondApproval(runId: string, approvalId: string, decision: string,
                  opts: { modifiedArgs?: string; allowNetwork?: boolean } | null): { ok: boolean } {
    if (this.current?.runId !== runId) return { ok: false }
    this.current.runner.respondApproval(approvalId, decision, opts)
    return { ok: true }
  }

  private activeTaskIds(): Set<string> {
    const s = new Set<string>()
    if (this.current) s.add(this.current.taskId)
    for (const r of readRuns(this.deps.userDataDir)) {
      if (r.status === 'running' || r.status === 'waiting_approval') s.add(r.taskId)
    }
    return s
  }

  private tick(now: number): void {
    const dir = this.deps.userDataDir
    const tasks = readTasks(dir)
    const d = decideTick(tasks, now, this.current?.taskId ?? null, this.queue, this.activeTaskIds())
    for (const id of d.miss) {
      const task = tasks.find(t => t.id === id)!
      upsertTask(dir, { ...task, lastFiredAt: now })
      putRun(dir, { runId: randomUUID(), taskId: id, startedAt: now, endedAt: now, status: 'interrupted', miss: true })
    }
    this.queue.push(...d.enqueue)
    for (const id of d.fire) {
      const task = tasks.find(t => t.id === id)!
      upsertTask(dir, { ...task, lastFiredAt: now })
      this.fire({ ...task, lastFiredAt: now }, false /* 已更 */)
    }
    if (d.miss.length || d.enqueue.length || d.fire.length) this.deps.onRunsChanged()
  }

  private fire(task: AutomationTask, updateLastFired: boolean): void {
    const dir = this.deps.userDataDir
    if (updateLastFired) upsertTask(dir, { ...task, lastFiredAt: Date.now() })
    const runId = randomUUID()
    const startedAt = Date.now()
    // 触发前校验项目目录(spec §7):失踪 → failed run,任务不自动禁用
    try {
      if (!fs.statSync(task.projectPath).isDirectory()) throw new Error()
    } catch {
      putRun(dir, { runId, taskId: task.id, startedAt, endedAt: startedAt, status: 'failed', summary: '项目目录不存在' })
      this.deps.onRunsChanged()
      return
    }
    putRun(dir, { runId, taskId: task.id, startedAt, status: 'running' })
    this.deps.onRunsChanged()
    const runner = new AutomationRunner(this.deps.env, os.homedir(), {
      onUpdate: state => {
        const status = state.phase === 'starting' ? 'running' : state.phase
        putRun(dir, {
          runId, taskId: task.id, startedAt,
          status: status as AutomationRun['status'],
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        })
        this.deps.onRunsChanged()
      },
      onApproval: (_approvalId, payload) => this.deps.onApproval(runId, payload),
    })
    this.current = { runId, taskId: task.id, runner }
    void runner.run(task.projectPath, task.prompt).then(finalState => {
      this.finishRun(runId, task.id, finalState, startedAt)
      this.current = null
      const next = this.queue.shift()
      if (next) {
        const t = readTasks(dir).find(x => x.id === next)
        if (t) { upsertTask(dir, { ...t, lastFiredAt: Date.now() }); this.fire({ ...t, lastFiredAt: Date.now() }, false) }
      }
    })
  }

  private finishRun(runId: string, taskId: string, finalState: RunState, startedAt?: number): void {
    const dir = this.deps.userDataDir
    const existing = readRuns(dir).find(r => r.runId === runId)
    const run: AutomationRun = {
      runId, taskId,
      startedAt: existing?.startedAt ?? startedAt ?? Date.now(),
      endedAt: Date.now(),
      status: (finalState.phase === 'starting' || finalState.phase === 'running' || finalState.phase === 'waiting_approval')
        ? 'interrupted' : finalState.phase,
      ...(finalState.sessionId ? { sessionId: finalState.sessionId } : {}),
      summary: summaryOf(finalState) || finalState.error || undefined,
    }
    putRun(dir, run)
    this.deps.onRunsChanged()
    this.deps.onTerminal(run)
  }
}
```

- [ ] **Step 4: 门禁** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2`(desktop 下)。Expected: tsc 0,vitest 全绿(+4)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/automationScheduler.ts desktop/test/automationScheduler.test.ts
git commit -m "feat(desktop): AutomationScheduler(decideTick 纯决策+并发1队列/miss/立即运行/退出清理)"
```

---

### Task 6: main IPC + push channel + 系统通知 + preload

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: Task 1/5 全部;Electron `Notification`。
- Produces(Task 7/8/9 依赖,逐字):
  - preload `WraithApi` +=:

```ts
  automationList(): Promise<{ tasks: AutomationTask[] }>
  automationUpsert(task: AutomationTask): Promise<{ ok: boolean }>
  automationRemove(id: string): Promise<{ ok: boolean }>
  automationRunNow(id: string): Promise<{ ok: boolean }>
  automationStop(runId: string): Promise<{ ok: boolean }>
  automationRuns(): Promise<{ runs: AutomationRun[] }>
  automationRespondApproval(runId: string, approvalId: string, decision: string,
    opts?: { modifiedArgs?: string; allowNetwork?: boolean }): Promise<{ ok: boolean }>
  automationPanelOpened(): Promise<{ ok: boolean }>
  onAutomationEvent(cb: (evt: AutomationEvent) => void): () => void   // channel 'wraith:automation-event'
```

- [ ] **Step 1: main/index.ts**

1. import 增:`Notification`(electron)、`os`已有、Task 1/5 模块:

```ts
import {
  readTasks as autoReadTasks, upsertTask as autoUpsertTask, removeTask as autoRemoveTask,
  readRuns as autoReadRuns, readLastPanelOpenedAt, writeLastPanelOpenedAt, badgeVisible,
} from './automationsStore'
import { AutomationScheduler } from './automationScheduler'
import type { AutomationTask, AutomationEvent } from '../shared/types'
```

2. State 区加(module scope):

```ts
let automationScheduler: AutomationScheduler | null = null

function pushAutomation(evt: AutomationEvent): void {
  mainWindow?.webContents.send('wraith:automation-event', evt)
}

function pushBadge(): void {
  const ud = app.getPath('userData')
  pushAutomation({ kind: 'badge', show: badgeVisible(autoReadRuns(ud), readLastPanelOpenedAt(ud)) })
}

function notifyOS(title: string, body: string): void {
  // 通知权限被拒/不支持:静默降级(红点仍然工作,spec §7)
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body })
      n.on('click', () => { mainWindow?.show(); pushAutomation({ kind: 'open-panel' }) })
      n.show()
    }
  } catch { /* 降级 */ }
}
```

3. `app.whenReady` 回调内(播种逻辑之后)实例化并启动:

```ts
  automationScheduler = new AutomationScheduler({
    userDataDir: app.getPath('userData'),
    env: process.env,
    homedir: os.homedir(),
    onRunsChanged: () => { pushAutomation({ kind: 'runs-changed' }); pushBadge() },
    onApproval: (runId, payload) => {
      pushAutomation({ kind: 'approval', runId, payload })
      pushBadge()
      notifyOS('Wraith 自动化等待审批', '有任务挂起等待你的审批')
    },
    onTerminal: run => {
      const label = run.status === 'success' ? '完成' : run.status === 'failed' ? '失败' : '中断'
      notifyOS('Wraith 自动化任务' + label, run.summary ?? '')
    },
  })
  automationScheduler.start()
```

4. `will-quit` 处理器内(child?.kill() 旁)加 `automationScheduler?.stopAll()`。
5. IPC handlers(项目 handlers 之后追加):

```ts
ipcMain.handle('wraith:automationList', async () => ({ tasks: autoReadTasks(app.getPath('userData')) }))
ipcMain.handle('wraith:automationUpsert', async (_e, task: AutomationTask) => {
  autoUpsertTask(app.getPath('userData'), task)
  return { ok: true }
})
ipcMain.handle('wraith:automationRemove', async (_e, id: string) => {
  autoRemoveTask(app.getPath('userData'), id)
  pushBadge()
  return { ok: true }
})
ipcMain.handle('wraith:automationRunNow', async (_e, id: string) => automationScheduler?.runNow(id) ?? { ok: false })
ipcMain.handle('wraith:automationStop', async (_e, runId: string) => automationScheduler?.stopRun(runId) ?? { ok: false })
ipcMain.handle('wraith:automationRuns', async () => ({ runs: autoReadRuns(app.getPath('userData')) }))
ipcMain.handle('wraith:automationRespondApproval', async (_e, runId: string, approvalId: string, decision: string,
    opts: { modifiedArgs?: string; allowNetwork?: boolean } | null) =>
  automationScheduler?.respondApproval(runId, approvalId, decision, opts) ?? { ok: false })
ipcMain.handle('wraith:automationPanelOpened', async () => {
  writeLastPanelOpenedAt(app.getPath('userData'), Date.now())
  pushBadge()
  return { ok: true }
})
```

- [ ] **Step 2: preload/index.ts** — 接口与实现按 Produces 逐字(invoke 同名 channel);`onAutomationEvent` 仿 `onEvent`:

```ts
  onAutomationEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, evt: AutomationEvent) => cb(evt)
    ipcRenderer.on('wraith:automation-event', listener)
    return () => { ipcRenderer.removeListener('wraith:automation-event', listener) }
  },
```

(import type 行加 `AutomationTask, AutomationRun, AutomationEvent`。)

- [ ] **Step 3: 门禁** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`(desktop 下)。Expected: 三绿。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(desktop): 自动化 IPC 九路 + push channel + 系统通知 + 退出清理"
```

---

### Task 7: Sidebar 红点 + App 视图/审批接线

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/App.tsx`

**Interfaces:**
- Consumes: Task 6 preload API;既有 ApprovalModal props(`approvalId/toolName/argsJson/dangerLevel/riskDescription/suggestion/beforeContent/onRespond/onReject`——读该文件为准)与 `ApprovalResponsePayload`。
- Produces(Task 8/9 依赖):
  - App `view: 'chat' | 'plugins' | 'automations'`;`automationApproval: { runId: string; payload: Record<string, unknown> } | null` state;`automationBadge: boolean` state;
  - Sidebar props += `onOpenAutomations: () => void`、`automationBadge: boolean`;`activeNav: 'plugins' | 'automations' | null`;
  - testid:`nav-automations`(启用)、`nav-automations-badge`(红点 span)。

- [ ] **Step 1: Sidebar.tsx**

- `activeNav` 类型放宽为 `'plugins' | 'automations' | null`;props += `onOpenAutomations`、`automationBadge: boolean`。
- 「自动化」项从禁用 Tooltip 组改为启用按钮(与 nav-plugins 同构):`data-testid="nav-automations"`,
  `onClick={onOpenAutomations}`,active 高亮同款;label 右侧红点:

```tsx
  {automationBadge && (
    <span data-testid="nav-automations-badge"
      className="ml-auto h-2 w-2 shrink-0 rounded-full bg-danger" />
  )}
```

(按钮内层容器需 `flex items-center`;「搜索」占位保持禁用+Tooltip 不动。)

- [ ] **Step 2: App.tsx**

1. `view` 态扩为三值;`const [automationApproval, setAutomationApproval] = useState<{ runId: string; payload: Record<string, unknown> } | null>(null)`;`const [automationBadge, setAutomationBadge] = useState(false)`。
2. 订阅 effect(与 onEvent 订阅并列,`[]` deps):

```ts
  useEffect(() => {
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind === 'badge') setAutomationBadge(evt.show)
      if (evt.kind === 'approval') setAutomationApproval({ runId: evt.runId, payload: evt.payload })
      if (evt.kind === 'open-panel') setView('automations')
      // 'runs-changed' 由面板自身拉取(Task 9),App 层不持 runs 态
    })
    return unsub
  }, [])
```

3. 自动化审批的 respond/reject(交互会话审批槽零触碰):

```ts
  const handleAutomationApprovalRespond = useCallback(async (payload: ApprovalResponsePayload) => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    try {
      await window.wraith.automationRespondApproval(cur.runId, String(cur.payload['approvalId']),
        payload.decision, payload.opts ?? undefined)
    } catch (err) { console.error('[wraith] automation respond error:', err) }
  }, [automationApproval])
```

(若 ApprovalModal 的 onRespond 签名与 `ApprovalResponsePayload` 不同——以组件文件实际为准适配,契约:decision + modifiedArgs/allowNetwork 二选项。onReject 同理:decision='REJECTED'。)

4. JSX:Sidebar 传 `activeNav={view === 'chat' ? null : view}`、`onOpenAutomations={() => setView('automations')}`、`automationBadge={automationBadge}`;主列条件渲染扩三分支(automations 分支 Task 8 放真面板,本任务先放 `<div data-testid="automations-panel-placeholder" />` 占位保编译);自动化 ApprovalModal 渲染(与交互审批并列,数据源不同):

```tsx
      {automationApproval && (
        <ApprovalModal
          key={'auto-' + String(automationApproval.payload['approvalId'])}
          approvalId={String(automationApproval.payload['approvalId'])}
          toolName={String(automationApproval.payload['toolName'] ?? '')}
          argsJson={String(automationApproval.payload['argsJson'] ?? '')}
          dangerLevel={String(automationApproval.payload['dangerLevel'] ?? '')}
          riskDescription={String(automationApproval.payload['riskDescription'] ?? '')}
          suggestion={(automationApproval.payload['suggestion'] as string | null) ?? null}
          beforeContent={(automationApproval.payload['beforeContent'] as string | null) ?? null}
          onRespond={handleAutomationApprovalRespond}
          onReject={() => void handleAutomationApprovalRespond({ decision: 'REJECTED' } as ApprovalResponsePayload)}
        />
      )}
```

(props 名/可空性以 ApprovalModal 实际签名为准逐一对齐;两个 Modal 同时出现的场景理论存在——交互审批优先渲染在后者之上即可,不做互斥。)

- [ ] **Step 3: 门禁** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`。Expected: 三绿。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 自动化视图态/红点/审批接线(独立槽,复用 ApprovalModal)"
```

---

### Task 8: AutomationsPanel + AutomationForm(定义侧)

**Files:**
- Create: `desktop/src/renderer/components/AutomationsPanel.tsx`
- Create: `desktop/src/renderer/components/AutomationForm.tsx`
- Modify: `desktop/src/renderer/App.tsx`(占位换真面板)

**Interfaces:**
- Consumes: Task 6 API、Task 7 view 态;`ProjectView`(项目下拉数据 = App 的 `projects` state)。
- Produces(Task 9 依赖):Panel props 与 testid:

```ts
interface AutomationsPanelProps {
  projects: ProjectView[]
  onBack: () => void
}
// testid:automations-back / automation-item / automation-toggle / automation-add /
//        automation-form(及字段 automation-form-name/prompt/project/schedule-kind/
//        schedule-minutes/schedule-time/schedule-weekday)/ automation-save /
//        automation-remove(二次确认)/ automation-run-now / automation-tab-def / automation-tab-runs
```

- [ ] **Step 1: AutomationForm.tsx**(完整组件)

```tsx
import { useState } from 'react'
import type { AutomationTask, AutomationSchedule, ProjectView } from '../../shared/types'

interface AutomationFormProps {
  initial: AutomationTask | null            // null = 新建
  projects: ProjectView[]
  onSave: (t: AutomationTask) => Promise<boolean>
  onRunNow: (t: AutomationTask) => Promise<void>   // 先保存再跑(spec §6.2)
  onRemove: (id: string) => void                    // 仅编辑态出现;确认逻辑在面板层
  removeConfirming: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export default function AutomationForm({ initial, projects, onSave, onRunNow, onRemove, removeConfirming }: AutomationFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [projectPath, setProjectPath] = useState(initial?.projectPath ?? projects[0]?.path ?? '')
  const [kind, setKind] = useState<AutomationSchedule['kind']>(initial?.schedule.kind ?? 'daily')
  const [minutes, setMinutes] = useState(initial?.schedule.kind === 'interval' ? String(initial.schedule.everyMinutes) : '60')
  const [time, setTime] = useState(initial?.schedule.kind !== 'interval' && initial ? initial.schedule.time : '09:00')
  const [weekday, setWeekday] = useState(initial?.schedule.kind === 'weekly' ? initial.schedule.weekday : 1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const buildTask = (): AutomationTask | null => {
    const n = name.trim(); const p = prompt.trim()
    if (!n || !p || !projectPath) { setError('name/prompt/项目 必填'); return null }
    let schedule: AutomationSchedule
    if (kind === 'interval') {
      const m = Number(minutes)
      if (!Number.isFinite(m) || m < 5) { setError('间隔最少 5 分钟'); return null }
      schedule = { kind: 'interval', everyMinutes: Math.floor(m) }
    } else if (kind === 'daily') {
      schedule = { kind: 'daily', time }
    } else {
      schedule = { kind: 'weekly', weekday, time }
    }
    const now = Date.now()
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: n, prompt: p, projectPath, schedule,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? now,
      enabledAt: initial?.enabledAt ?? now,
      lastFiredAt: initial?.lastFiredAt ?? null,
    }
  }

  const save = async (): Promise<AutomationTask | null> => {
    const t = buildTask()
    if (!t) return null
    setSaving(true); setError(null)
    const ok = await onSave(t)
    setSaving(false)
    if (!ok) { setError('保存失败'); return null }
    return t
  }

  return (
    <div data-testid="automation-form" className="flex max-w-xl flex-col gap-3">
      <label className="text-xs text-fg-muted">名称
        <input data-testid="automation-form-name" value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-fg-muted">Prompt(任务内容)
        <textarea data-testid="automation-form-prompt" value={prompt} rows={4} onChange={e => setPrompt(e.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-fg-muted">项目
        <select data-testid="automation-form-project" value={projectPath} onChange={e => setProjectPath(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none">
          {projects.map(p => <option key={p.path} value={p.path}>{p.name || p.path}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-2 text-xs text-fg-muted">
        <label>调度
          <select data-testid="automation-form-schedule-kind" value={kind}
            onChange={e => setKind(e.target.value as AutomationSchedule['kind'])}
            className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none">
            <option value="interval">每隔 N 分钟</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        {kind === 'interval' && (
          <label>分钟
            <input data-testid="automation-form-schedule-minutes" value={minutes} onChange={e => setMinutes(e.target.value)}
              className="mt-1 w-20 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
        {kind === 'weekly' && (
          <label>星期
            <select data-testid="automation-form-schedule-weekday" value={weekday} onChange={e => setWeekday(Number(e.target.value))}
              className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none">
              {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
            </select>
          </label>
        )}
        {kind !== 'interval' && (
          <label>时刻
            <input data-testid="automation-form-schedule-time" type="time" value={time} onChange={e => setTime(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
      </div>
      {error && <div className="text-xs text-danger">{error}</div>}
      <div className="flex gap-2">
        <button data-testid="automation-save" disabled={saving} onClick={() => void save()}
          className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60">保存</button>
        <button data-testid="automation-run-now" disabled={saving}
          onClick={() => void save().then(t => { if (t) void onRunNow(t) })}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg hover:border-accent disabled:opacity-60">
          立即运行
        </button>
        {initial && (
          <button data-testid="automation-remove" onClick={() => onRemove(initial.id)}
            className={'ml-auto rounded-lg border px-4 py-2 text-xs ' +
              (removeConfirming ? 'border-danger text-danger' : 'border-border text-fg-muted hover:text-danger')}>
            {removeConfirming ? '确认删除?' : '删除任务'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: AutomationsPanel.tsx**(骨架:左列 + 定义 tab;runs tab 本任务放占位 `<div data-testid="automation-runs" />`,Task 9 实装)

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { AutomationTask, ProjectView } from '../../shared/types'
import AutomationForm from './AutomationForm'
import { computeNextRunLabel } from '../lib/automationLabels'

interface AutomationsPanelProps {
  projects: ProjectView[]
  onBack: () => void
}

export default function AutomationsPanel({ projects, onBack }: AutomationsPanelProps): JSX.Element {
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<'def' | 'runs'>('def')
  const [removeConfirming, setRemoveConfirming] = useState(false)

  const fetchTasks = useCallback(async () => {
    try { const { tasks } = await window.wraith.automationList(); setTasks(tasks) }
    catch (err) { console.error('[wraith] automationList error:', err) }
  }, [])

  useEffect(() => {
    void fetchTasks()
    void window.wraith.automationPanelOpened() // 清红点(spec §3)
  }, [fetchTasks])

  useEffect(() => { setRemoveConfirming(false); setTab('def') }, [selectedId, creating])

  const current = creating ? null : tasks.find(t => t.id === selectedId) ?? tasks[0] ?? null

  const handleSave = useCallback(async (t: AutomationTask): Promise<boolean> => {
    try { await window.wraith.automationUpsert(t); await fetchTasks(); setCreating(false); setSelectedId(t.id); return true }
    catch (err) { console.error('[wraith] automationUpsert error:', err); return false }
  }, [fetchTasks])

  const handleRunNow = useCallback(async (t: AutomationTask) => {
    try { await window.wraith.automationRunNow(t.id); setTab('runs') }
    catch (err) { console.error('[wraith] automationRunNow error:', err) }
  }, [])

  const handleRemove = useCallback((id: string) => {
    if (!removeConfirming) { setRemoveConfirming(true); return }
    setRemoveConfirming(false)
    void window.wraith.automationRemove(id).then(() => { setSelectedId(null); void fetchTasks() })
  }, [removeConfirming, fetchTasks])

  const handleToggle = useCallback(async (t: AutomationTask) => {
    const now = Date.now()
    await window.wraith.automationUpsert({ ...t, enabled: !t.enabled, enabledAt: !t.enabled ? now : t.enabledAt })
    void fetchTasks()
  }, [fetchTasks])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="automations-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">自动化</span>
        <span className="text-xs text-fg-subtle">定时任务</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex-1 overflow-y-auto p-2">
            {tasks.length === 0 && <div className="px-2 py-3 text-xs text-fg-subtle">还没有任务</div>}
            {tasks.map(t => (
              <div key={t.id} className="mb-0.5 flex items-center gap-1">
                <button data-testid="automation-item" onClick={() => { setCreating(false); setSelectedId(t.id) }}
                  className={'flex-1 truncate rounded-lg px-2 py-2 text-left text-xs ' +
                    (current?.id === t.id && !creating ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                  <div className="truncate">{t.name}</div>
                  <div className="text-[10px] text-fg-subtle">{t.enabled ? computeNextRunLabel(t) : '已停用'}</div>
                </button>
                <button data-testid="automation-toggle" title={t.enabled ? '停用' : '启用'}
                  onClick={() => void handleToggle(t)}
                  className={'shrink-0 rounded px-1.5 py-1 text-xs ' + (t.enabled ? 'text-success' : 'text-fg-subtle')}>
                  {t.enabled ? '●' : '○'}
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button data-testid="automation-add" onClick={() => { setCreating(true); setSelectedId(null) }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60">
              ＋ 新建任务
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {!current && !creating ? (
            <div className="text-xs text-fg-subtle">选择或新建任务</div>
          ) : (
            <>
              <div className="mb-2 flex gap-1 border-b border-border">
                <button data-testid="automation-tab-def" onClick={() => setTab('def')}
                  className={'px-3 py-1.5 text-xs ' + (tab === 'def' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>定义</button>
                <button data-testid="automation-tab-runs" onClick={() => setTab('runs')} disabled={creating}
                  className={'px-3 py-1.5 text-xs disabled:opacity-40 ' + (tab === 'runs' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>运行历史</button>
              </div>
              {tab === 'def' ? (
                <AutomationForm key={creating ? 'new' : current!.id}
                  initial={creating ? null : current}
                  projects={projects}
                  onSave={handleSave} onRunNow={handleRunNow}
                  onRemove={handleRemove} removeConfirming={removeConfirming} />
              ) : (
                <div data-testid="automation-runs" className="text-xs text-fg-subtle">运行历史(Task 9 实装)</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

另建 `desktop/src/renderer/lib/automationLabels.ts`(下次运行时间标签,复用 Task 2 纯函数):

```ts
import type { AutomationTask } from '../../shared/types'
import { computeNextRun } from '../../main/automationSchedule'

/** 「下次 MM-DD HH:mm」标签;renderer 直接复用 main 的纯函数(无 Node 依赖)。 */
export function computeNextRunLabel(t: AutomationTask): string {
  const next = new Date(computeNextRun(t.schedule, Date.now(), t.lastFiredAt, t.enabledAt))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `下次 ${pad(next.getMonth() + 1)}-${pad(next.getDate())} ${pad(next.getHours())}:${pad(next.getMinutes())}`
}
```

(automationSchedule.ts 无 Node import,renderer 可安全引用;若 tsconfig 路径限制则把该纯函数移至 `shared/`,契约不变。)

- [ ] **Step 3: App.tsx** — automations 分支占位换 `<AutomationsPanel projects={projects} onBack={() => setView('chat')} />`。

- [ ] **Step 4: 门禁** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`。Expected: 三绿。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/AutomationsPanel.tsx desktop/src/renderer/components/AutomationForm.tsx desktop/src/renderer/lib/automationLabels.ts desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 自动化整页面板+任务表单(三档调度/项目下拉/立即运行/删除确认)"
```

---

### Task 9: 运行历史 tab(挂起审批/终止/跳会话)

**Files:**
- Create: `desktop/src/renderer/components/AutomationRuns.tsx`
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx`(占位换实装 + runs-changed 刷新)
- Modify: `desktop/src/renderer/App.tsx`(跳会话回调下传)

**Interfaces:**
- Consumes: Task 6 `automationRuns/automationStop`、Task 7 approval push(App 已接);App 既有 `switchToProject`+`handleSelectSession` 链路。
- Produces:testid `automation-run-item / automation-run-approve / automation-run-stop / automation-run-open`。

- [ ] **Step 1: AutomationRuns.tsx**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { AutomationRun } from '../../shared/types'

interface AutomationRunsProps {
  taskId: string
  onOpenSession(projectPath: string, sessionId: string): void
  projectPath: string
  onApprove(runId: string): void        // App 弹已缓存的审批(经 push 事件早已入槽;此钮兜底重弹)
}

const STATUS_LABEL: Record<AutomationRun['status'], string> = {
  running: '运行中', waiting_approval: '等待审批', success: '成功', failed: '失败', interrupted: '中断',
}
const STATUS_COLOR: Record<AutomationRun['status'], string> = {
  running: 'text-warning', waiting_approval: 'text-danger', success: 'text-success',
  failed: 'text-danger', interrupted: 'text-fg-subtle',
}

export default function AutomationRuns({ taskId, projectPath, onOpenSession, onApprove }: AutomationRunsProps): JSX.Element {
  const [runs, setRuns] = useState<AutomationRun[]>([])

  const fetchRuns = useCallback(async () => {
    try {
      const { runs } = await window.wraith.automationRuns()
      setRuns(runs.filter(r => r.taskId === taskId).sort((a, b) => b.startedAt - a.startedAt))
    } catch (err) { console.error('[wraith] automationRuns error:', err) }
  }, [taskId])

  useEffect(() => {
    void fetchRuns()
    return window.wraith.onAutomationEvent(evt => { if (evt.kind === 'runs-changed') void fetchRuns() })
  }, [fetchRuns])

  const fmt = (ts: number): string => {
    const d = new Date(ts); const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const dur = (r: AutomationRun): string =>
    r.endedAt ? `${Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000))}s` : '—'

  return (
    <div className="flex flex-col gap-1">
      {runs.length === 0 && <div className="text-xs text-fg-subtle">还没有运行记录</div>}
      {runs.map(r => (
        <div key={r.runId} data-testid="automation-run-item" className="rounded-lg bg-surface/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={STATUS_COLOR[r.status]}>{r.miss ? '错过(miss)' : STATUS_LABEL[r.status]}</span>
            <span className="text-fg-subtle">{fmt(r.startedAt)} · {dur(r)}</span>
            <span className="ml-auto flex gap-2">
              {r.status === 'waiting_approval' && (
                <button data-testid="automation-run-approve" onClick={() => onApprove(r.runId)}
                  className="rounded border border-danger px-2 py-0.5 text-[11px] text-danger">处理审批</button>
              )}
              {(r.status === 'running' || r.status === 'waiting_approval') && (
                <button data-testid="automation-run-stop"
                  onClick={() => void window.wraith.automationStop(r.runId).then(() => void fetchRuns())}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-danger">终止</button>
              )}
              {r.sessionId && r.endedAt !== undefined && (
                <button data-testid="automation-run-open" onClick={() => onOpenSession(projectPath, r.sessionId!)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-accent">查看会话</button>
              )}
            </span>
          </div>
          {r.summary && <div className="mt-1 truncate text-xs text-fg-muted">{r.summary}</div>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 接线**

- AutomationsPanel:props += `onOpenSession(projectPath, sessionId)` 与 `onApprove(runId)`(App 下传);
  runs tab 占位换 `<AutomationRuns taskId={current!.id} projectPath={current!.projectPath} onOpenSession={onOpenSession} onApprove={onApprove} />`。
- App.tsx:

```ts
  const handleOpenAutomationSession = useCallback(async (projectPath: string, sessionId: string) => {
    setView('chat')
    if (projectPath !== state.workspace) await switchToProject(projectPath)
    await handleSelectSession(sessionId)
  }, [state.workspace, switchToProject, handleSelectSession])

  // 「处理审批」重弹:App 用 ref 缓存最近一次 approval push(state 槽被 Esc 清掉后仍可恢复)
  const automationApprovalRef = useRef<{ runId: string; payload: Record<string, unknown> } | null>(null)
  // onAutomationEvent 的 approval 分支同时写 ref 与 state(Task 7 的订阅 effect 补一行 ref 赋值)
  const handleReopenApproval = useCallback((runId: string) => {
    const cached = automationApprovalRef.current
    if (cached && cached.runId === runId) setAutomationApproval(cached)
  }, [])
```

- App JSX:`<AutomationsPanel projects={projects} onBack={...} />` 传参扩为
  `onOpenSession={handleOpenAutomationSession} onApprove={handleReopenApproval}`(Panel props 同步扩展)。

- [ ] **Step 3: 门禁** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run 2>&1 | tail -2 && npm run build > /dev/null && echo BUILD_OK`。Expected: 三绿。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/components/AutomationRuns.tsx desktop/src/renderer/components/AutomationsPanel.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 运行历史 tab(挂起审批重弹/终止/跳转会话)"
```

---

### Task 10: E2E T33–T37(mock 复用,立即运行驱动)

**Files:**
- Modify: `desktop/test/e2e/shell.e2e.ts`
- Modify(如需): `desktop/test/fixtures/mock-appserver.mjs`(检查 message.delta/message.end 已有;`MOCK_APPROVAL_TOOL` 已有;若 turn 序列字段名不同以 mock 实际为准,新用例适配 mock 而非改 mock)

**Interfaces:**
- Consumes: 全部前端 testid;自动化子进程 spawn 继承 app env → `WRAITH_APPSERVER_CMD` 注入 mock 天然生效。

- [ ] **Step 1: 新用例**(追加文件尾;helper 沿用 launchMcpApp 风格新建 `launchAutoApp`)

```ts
// ---------------------------------------------------------------------------
// Phase E-2: 自动化(T33–T37)——「立即运行」驱动,调度到点不进 E2E(纯函数已单测)
// ---------------------------------------------------------------------------

async function launchAutoApp(extraEnv: Record<string, string> = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-auto-'))
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-auto-proj-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: proj,
      WRAITH_E2E_PROJECTS: JSON.stringify([{ path: proj, lastUsedAt: 1000 }]),
      ...extraEnv,
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win, cleanup: () => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }) } }
}

async function createAndRunTask(win: Page, name: string): Promise<void> {
  await win.locator('[data-testid="nav-automations"]').click()
  await win.locator('[data-testid="automation-add"]').click()
  await win.locator('[data-testid="automation-form-name"]').fill(name)
  await win.locator('[data-testid="automation-form-prompt"]').fill('总结一下今天的进展')
  await win.locator('[data-testid="automation-run-now"]').click()
}

test('T33 建任务+立即运行 → 运行历史出现 success 与摘要', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await createAndRunTask(win, '日报')
  // 立即运行后面板自动切 runs tab;mock turn 秒级完成
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await expect(win.locator('[data-testid="automation-run-item"]').first()).not.toContainText('运行中')
  await app.close(); cleanup()
})

test('T34 挂起审批链:红点 → 处理审批 → ApprovalModal → 批准 → 完成', async () => {
  const { app, win, cleanup } = await launchAutoApp({ MOCK_APPROVAL_TOOL: 'execute_command' })
  await createAndRunTask(win, '要审批的任务')
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('等待审批', { timeout: 15000 })
  // 审批 push 已弹 Modal(App 接线);若被 Esc 关闭场景走「处理审批」钮——此处直接断言 Modal 可见
  await expect(win.locator('[data-testid="approval-modal"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="approval-approve"]').click()
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await app.close(); cleanup()
})

test('T35 终止 running → interrupted', async () => {
  const { app, win, cleanup } = await launchAutoApp({ MOCK_SLOW_TURN: '1' })
  await createAndRunTask(win, '慢任务')
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('运行中', { timeout: 15000 })
  await win.locator('[data-testid="automation-run-stop"]').click()
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('中断', { timeout: 15000 })
  await app.close(); cleanup()
})

test('T36 启停 toggle 与删除二次确认', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await win.locator('[data-testid="nav-automations"]').click()
  await win.locator('[data-testid="automation-add"]').click()
  await win.locator('[data-testid="automation-form-name"]').fill('开关任务')
  await win.locator('[data-testid="automation-form-prompt"]').fill('p')
  await win.locator('[data-testid="automation-save"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toHaveCount(1, { timeout: 5000 })
  await win.locator('[data-testid="automation-toggle"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toContainText('已停用', { timeout: 5000 })
  await win.locator('[data-testid="automation-remove"]').click()
  await expect(win.locator('[data-testid="automation-remove"]')).toHaveText('确认删除?')
  await win.locator('[data-testid="automation-remove"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toHaveCount(0, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T37 运行历史跳转会话(回放可见)', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await createAndRunTask(win, '跳转任务')
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await win.locator('[data-testid="automation-run-open"]').first().click()
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 10000 })
  await expect(win.locator('text=之前问的问题')).toBeVisible({ timeout: 10000 }) // mock resume 回放
  await app.close(); cleanup()
})
```

注:`approval-modal/approval-approve` 两个 testid 以 ApprovalModal 现有实现为准(grep 该文件;若名不同以现名替换,断言不变)。旧用例适配:grep `nav-automations` — 若既有用例断言其 disabled(如 Test 6 家族),改为 enabled 断言(与 E-1 适配 nav-plugins 同款,一处小改)。

- [ ] **Step 2: 全量 E2E** — Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run e2e 2>&1 | tail -3`(timeout ≥ 540000ms)。Expected: 37 passed(32 旧含适配 + 5 新)。

- [ ] **Step 3: Commit**

```bash
git add desktop/test/e2e/shell.e2e.ts desktop/test/fixtures/mock-appserver.mjs
git commit -m "test(desktop): E2E T33-T37 自动化全链路(立即运行/挂起审批/终止/跳会话)"
```

---

### Task 11: ROADMAP 更新

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: 编辑**(数字以实测为准)

1. 「已实现 ✅」表尾追加:

```markdown
| **Phase E-2** 定时任务 | Electron main 调度(30s tick/`computeNextRun` 三档/并发1队列/miss 可见);每次运行独立 app-server 子进程(Java 零改动);**遇审批挂起等人**(复用 ApprovalModal,独立 push channel);结果四件套(会话落盘/运行历史/系统通知/侧栏红点);`automations.json`+`runs.json`(每任务留50) | vitest ~135、Playwright 37/37;spec/plan `docs/*/2026-07-02-desktop-phase-e2*.md` |
```

2. 「进行中 🟡」改:`（无——Phase A、B、C、D、E-1、E-2 已合并 main。下一阶段 **Phase F**（打包:jpackage 裁剪 JRE + electron-builder + 签名/notarize)待启动。）`
3. 「未实现 ⬜」表删 Phase E-2 行(仅剩 Phase F)。
4. 「待眼验」追加:`- **Phase E-2 新增**——真 30s tick 到点触发一次真任务;macOS 通知实机点击唤起并打开面板;app 退出时运行中任务落 interrupted;审批挂起过夜再处理。`
5. 「最后更新」日期核对。

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): Phase E-2 定时任务标记已实现"
```

---

## 收尾(计划外置,执行技能接管)

全任务完成后:整支终审(最强模型;重点:①调度器与 store 的读-改-写竞态(tick/IPC 并发)②Runner 生命周期泄漏(settle 双调/僵尸子进程)③审批 ref 缓存与 run 终态的一致性④主会话链路零触碰核查)→ 一个修复 subagent → Java 全量(应持平 939@3F/38E,零 Java 改动)+ vitest + E2E + tsc 全绿 → merge --no-ff 回 main → push。眼验按 ROADMAP 清单(真 tick 触发不进自动化测试)。
