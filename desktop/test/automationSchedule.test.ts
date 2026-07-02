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
