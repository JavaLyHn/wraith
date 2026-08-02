import type { DurableTaskView } from './types'

const TERMINAL = new Set(['completed', 'failed', 'canceled'])

export function isActive(t: DurableTaskView): boolean {
  return !TERMINAL.has(t.status)
}

/** 正在跑(running)+ 排队中(enqueued)的总数 —— 侧栏那个计数。 */
export function activeCount(tasks: DurableTaskView[]): number {
  return tasks.filter(isActive).length
}

export interface WatchState {
  /** 已经"交待过"的任务 id:要么首轮见到时就是终态(历史),要么完成时已经播报过。 */
  settled: Set<string>
  /** 是否已完成首轮播种。首轮只记录、不播报。 */
  seeded: boolean
}

export function initialWatchState(): WatchState {
  return { settled: new Set(), seeded: false }
}

export interface WatchStep {
  next: WatchState
  /** 本次轮询里**新**变成终态、需要在对话里播报的任务(按列表顺序)。 */
  finished: DurableTaskView[]
  active: number
}

/**
 * 一次轮询 → 该播报谁。
 *
 * <p>**首轮必须静默**:应用刚起来时 taskList 里躺着一堆历史完成项,若不播种就会一次性
 * 往对话里灌十几条「后台任务完成」——用户什么都没做却被刷屏,且那些任务可能是几天前跑的。
 * 所以首轮只把当时所有终态 id 记进 settled,一条都不播。
 *
 * <p>只播报"**看着它从活跃变终态**"的任务还不够:轮询有间隔,一个 2s 就跑完的任务可能
 * 从未在活跃态被观测到。因此判据是「终态 且 不在 settled 里」——首轮之后新出现的终态任务
 * 都算数,不要求先看见它 running。
 */
export function stepWatch(state: WatchState, tasks: DurableTaskView[]): WatchStep {
  const active = activeCount(tasks)
  if (!state.seeded) {
    const settled = new Set<string>()
    for (const t of tasks) if (!isActive(t)) settled.add(t.id)
    return { next: { settled, seeded: true }, finished: [], active }
  }
  const settled = new Set(state.settled)
  const finished: DurableTaskView[] = []
  for (const t of tasks) {
    if (isActive(t) || settled.has(t.id)) continue
    settled.add(t.id)
    finished.push(t)
  }
  return { next: { settled, seeded: true }, finished, active }
}

/** 有任务在跑时勤快点,闲着时别老敲后端。 */
export function pollIntervalMs(active: number): number {
  return active > 0 ? 3_000 : 15_000
}

/** 药丸文案:「后台任务完成:xxx · 11s」/ 失败与取消各有说法。 */
export function taskDoneLabel(t: DurableTaskView): string {
  const title = oneLine(t.prompt, 40)
  const secs = t.durationMs > 0 ? ` · ${Math.max(1, Math.round(t.durationMs / 1000))}s` : ''
  if (t.status === 'failed') return `后台任务失败:${title}${secs}`
  if (t.status === 'canceled') return `后台任务已取消:${title}`
  return `后台任务完成:${title}${secs}`
}

function oneLine(s: string, max: number): string {
  const flat = (s ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max) + '…'
}
