import type { QqPendingItem } from '../../shared/types'

/** 排序:审批项置顶(⚠️ 阻塞任务执行),组内按 ts 倒序;不改原数组。 */
export function sortQqPending(items: QqPendingItem[]): QqPendingItem[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'approval' ? -1 : 1
    return b.ts - a.ts
  })
}
