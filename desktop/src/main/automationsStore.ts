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
  } catch (err) {
    // 缺失文件是常态(首次运行)→ 静默;坏 JSON 才警告(spec §7 要求)
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[automations] 配置文件损坏,按空处理:', file)
    }
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

/**
 * I-1:启动清扫。上次运行的非终态 run(running/waiting_approval,以及防御性覆盖内部相 starting)随 app
 * 退出即失去其 runner 子进程,却仍以「运行中/等待审批」滞留 runs → 任务砖死(activeTaskIds 永占)、
 * 红点永亮、终止钮点了无效(current 为 null)。whenReady 里 scheduler 实例化前调用,改为 interrupted。
 * 无非终态则不写(避免无谓 I/O)。AutomationRun 无 error 字段,原因落 summary(不覆盖已有 summary)。
 */
export function sweepNonTerminalRuns(dir: string): void {
  const f = readJson<RunsFile>(runsPath(dir))
  const runs = f?.runs ?? []
  const NON_TERMINAL = new Set<string>(['running', 'waiting_approval', 'starting'])
  let changed = false
  const swept = runs.map(r => {
    if (!NON_TERMINAL.has(r.status)) return r
    changed = true
    return { ...r, status: 'interrupted' as const, endedAt: Date.now(), summary: r.summary ?? '上次运行随应用退出中断' }
  })
  if (changed) writeJson(runsPath(dir), { ...(f ?? {}), runs: swept })
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
