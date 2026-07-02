import type { AutomationTask } from '../../shared/types'
import { computeNextRun } from '../../main/automationSchedule'

/** 「下次 MM-DD HH:mm」标签;renderer 直接复用 main 的纯函数(无 Node 依赖)。 */
export function computeNextRunLabel(t: AutomationTask): string {
  const next = new Date(computeNextRun(t.schedule, Date.now(), t.lastFiredAt, t.enabledAt))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `下次 ${pad(next.getMonth() + 1)}-${pad(next.getDate())} ${pad(next.getHours())}:${pad(next.getMinutes())}`
}
