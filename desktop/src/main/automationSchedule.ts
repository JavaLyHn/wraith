import type { AutomationSchedule } from '../shared/types'

/**
 * daily/weekly 到点判定的宽限窗(C1):3 个 tick(30s * 3 = 90s)。
 *
 * 背景:调度器 tick 以 `now >= nextRun` 判到点,但 tick 相位与 HH:mm 时刻毫秒级错开——
 * 若时刻一过(毫秒级)就跳下一周期,`now >= nextRun` 在两次 tick 之间永无交集 → daily/weekly 永不触发。
 * 宽限语义:时刻过后 90s 内仍视为「未过」、返回本时刻(调度器可命中触发);超出宽限才视为错过、跳下一周期。
 * 这样既能触发,又保住「app 关闭期间的时刻不补跑」(关机数分钟即超宽限)。
 */
const GRACE_MS = 90_000

/**
 * 下一次应触发时刻(epoch ms;可 <= now,调用方以 now>=值 判到点)。本地时区;DST 不特殊处理(spec §4)。
 *
 * 对于 interval:返回值 = 锚点(lastFiredAt ?? enabledAt) + 一个周期,是"单步"而非追赶到 now。
 * 返回值可能早于 now,由调用方(调度器 decideTick)以 miss 记录 + 更新 lastFiredAt 来推进锚点。
 *
 * 对于 daily/weekly:本时刻已触发过(lastFiredAt>=t)则跳下一周期;过期超出 GRACE_MS 宽限则跳下一周期;
 * 宽限窗内(now-90s ≤ t ≤ now)返回本时刻,使调度器 `now >= nextRun` 得以命中触发(见 GRACE_MS 说明)。
 */
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
    // 本时刻已触发过 → 跳明天;过期超出宽限 → 跳明天;宽限窗内仍返回本时刻(C1)。
    // DST 切换日毫秒加法理论偏移 1 小时,本期不处理(spec §4)。
    if ((lastFiredAt !== null && lastFiredAt >= t) || t < now - GRACE_MS) t += 24 * 3_600_000
    return t
  }
  // weekly
  const day = new Date(now)
  const delta = (schedule.weekday - day.getDay() + 7) % 7
  day.setDate(day.getDate() + delta)
  let t = at(day)
  // 本时刻已触发过 → 跳下周;过期超出宽限 → 跳下周;宽限窗内仍返回本时刻(C1)。
  // DST 切换日毫秒加法理论偏移 1 小时,本期不处理(spec §4)。
  if ((lastFiredAt !== null && lastFiredAt >= t) || t < now - GRACE_MS) t += 7 * 24 * 3_600_000
  return t
}
