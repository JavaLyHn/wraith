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
