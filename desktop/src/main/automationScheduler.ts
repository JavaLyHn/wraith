import fs from 'fs'
import { randomUUID } from 'crypto'
import type { AutomationTask, AutomationRun } from '../shared/types'
import { computeNextRun } from './automationSchedule'
import { readTasks, upsertTask, readRuns, putRun } from './automationsStore'
import { AutomationRunner } from './automationRunner'
import { summaryOf, type RunState } from './automationRunState'

const TICK_MS = 30_000

/** 纯决策:本 tick 该做什么。queue/runningTaskId 由壳持有传入。 */
export interface TickDecision { fire: string[]; enqueue: string[]; miss: string[] }

export function decideTick(
  tasks: AutomationTask[], now: number,
  runningTaskId: string | null, queuedTaskIds: string[],
  activeTaskIds: Set<string>,           // 有 running/waiting_approval run 的任务
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
    onTerminal(run: AutomationRun): void       // 终态:main 发通知用
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

  // I-1: tick 全程同步无 await;readTasks→upsertTask 读-改-写依赖此不变量,未来插入 await 会引入丢写
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

  private fire(task: AutomationTask, updateLastFired: boolean): boolean {
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
      return false
    }
    putRun(dir, { runId, taskId: task.id, startedAt, status: 'running' })
    this.deps.onRunsChanged()
    const runner = new AutomationRunner(this.deps.env, this.deps.homedir, {
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
    }).catch(err => {
      console.error('[AutomationScheduler] runner.run() threw unexpectedly:', err)
      this.finishRun(runId, task.id, { phase: 'failed', error: String(err) } as RunState, startedAt)
    }).finally(() => {
      this.current = null
      // I-3: while drain:跳过被禁用/已删除项及 statSync 失败项,直到成功 spawn 一个或队列耗尽
      let next: string | undefined
      while ((next = this.queue.shift()) !== undefined) {
        const t = readTasks(dir).find(x => x.id === next)
        // I-2: 出队时重校验 enabled,任务排队期间若被禁用则跳过,继续下一项
        if (!t || !t.enabled) continue
        // 保持现有出队-启动语义完全不变(包括 lastFiredAt 处理方式)
        upsertTask(dir, { ...t, lastFiredAt: Date.now() })
        if (this.fire({ ...t, lastFiredAt: Date.now() }, false)) break   // spawn 成功才停;失败继续 drain
      }
    })
    return true
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
