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

describe('computeNextRun — 90s 宽限窗边界(C1:daily/weekly 到点判定的命门)', () => {
  // 现有用例覆盖了「恰等 t===now」与「已过 30min(远超宽限)」两端,却跳过了中间那条
  // 90s 宽限边界——而它正是 daily/weekly 能否触发的命门:tick 相位与 HH:mm 毫秒级错开,
  // 没有宽限就永远 now>=nextRun 不成立 → 永不触发。这里把边界两侧各钉一针。
  const daily = { kind: 'daily', time: '14:30' } as const
  const t = T(2026, 7, 2, 14, 30) // 今天 14:30 这个时刻

  it('时刻刚过 60s、仍在宽限内 → 返回今天该时刻(调度器随后可命中触发)', () => {
    expect(computeNextRun(daily, t + 60_000, null, 0)).toBe(t)
  })

  it('恰在边界 now-90s===t → 严格 < 不成立、判未过 → 仍返回今天', () => {
    expect(computeNextRun(daily, t + 90_000, null, 0)).toBe(t)
  })

  it('刚跨出宽限 1ms → 判为错过 → 跳明天(不补跑,保住关机期间不追赶)', () => {
    expect(computeNextRun(daily, t + 90_001, null, 0)).toBe(t + 24 * 3_600_000)
  })

  it('宽限内但本时刻已触发过(lastFiredAt>=t)→ 仍跳明天(不重复触发)', () => {
    expect(computeNextRun(daily, t + 30_000, t, 0)).toBe(t + 24 * 3_600_000)
  })

  it('weekly 同理:本周该天刚过且宽限内取本周,超宽限跳下周', () => {
    const weekly = { kind: 'weekly', weekday: 4, time: '09:00' } as const // 2026-07-02 周四
    const wt = T(2026, 7, 2, 9, 0)
    expect(computeNextRun(weekly, wt + 45_000, null, 0)).toBe(wt)
    expect(computeNextRun(weekly, wt + 90_001, null, 0)).toBe(wt + 7 * 24 * 3_600_000)
  })
})
