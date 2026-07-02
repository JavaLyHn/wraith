import { describe, it, expect } from 'vitest'
import { decideTick } from '../src/main/automationScheduler'
import type { AutomationTask } from '../src/shared/types'

// ---------------------------------------------------------------------------
// C1 tick 粒度集成测试:不依赖真实定时器,循环模拟 now 以 30_000ms 步进。
// 用 decideTick(纯函数)判 fire;命中后按调度器语义置 lastFiredAt = now 再继续步进。
// 验证宽限窗修复后 daily/weekly 真能触发一次(且不多触发、app 关着不补跑)。
// ---------------------------------------------------------------------------

const TICK = 30_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'a', name: 'a', prompt: 'p', projectPath: '/p', enabled: true,
    schedule: { kind: 'interval', everyMinutes: 30 }, createdAt: 0, enabledAt: 0, lastFiredAt: null, ...over,
  }
}

/**
 * 以 TICK 步进模拟调度器:每步用 decideTick 判 fire,命中即计数并把该任务 lastFiredAt 置为当前 now
 * (调度器 tick 触发时的语义)。返回触发次数。空闲单任务:runningTaskId 恒 null、queue 恒空。
 */
function simulate(t: AutomationTask, startNow: number, spanMs: number): { fires: number; fireTimes: number[] } {
  let cur = { ...t }
  const fireTimes: number[] = []
  for (let now = startNow; now <= startNow + spanMs; now += TICK) {
    const d = decideTick([cur], now, null, [], new Set())
    if (d.fire.includes(cur.id)) {
      fireTimes.push(now)
      cur = { ...cur, lastFiredAt: now }
    } else if (d.miss.includes(cur.id)) {
      // 空闲单任务下 miss 不应发生;但若发生也按调度器语义推进锚点
      cur = { ...cur, lastFiredAt: now }
    }
  }
  return { fires: fireTimes.length, fireTimes }
}

// 本地时区某天 HH:mm 的 epoch ms
const at = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('scheduler tick 集成(C1 宽限窗)', () => {
  it('daily 14:30 模拟 24h:恰好触发 1 次', () => {
    const t = task({ schedule: { kind: 'daily', time: '14:30' }, enabledAt: at(2026, 7, 1, 9, 0) })
    // 从今天 08:00 起步进 24h(覆盖今天 14:30 与明天 14:30 之间的窗口)
    const start = at(2026, 7, 2, 8, 0)
    const { fires, fireTimes } = simulate(t, start, DAY)
    expect(fires).toBe(1)
    // 触发点落在今天 14:30 的宽限窗内(14:30 <= now <= 14:30+90s)
    const target = at(2026, 7, 2, 14, 30)
    expect(fireTimes[0]!).toBeGreaterThanOrEqual(target)
    expect(fireTimes[0]!).toBeLessThanOrEqual(target + 90_000)
  })

  it('weekly 任务模拟 168h:恰好触发 1 次', () => {
    // 2026-07-02 是周四(weekday 4)
    const t = task({ schedule: { kind: 'weekly', weekday: 4, time: '09:00' }, enabledAt: at(2026, 7, 1, 0, 0) })
    // 从周四 08:00 起步进 7 天(覆盖本周四 09:00 与下周四 09:00 之间)
    const start = at(2026, 7, 2, 8, 0)
    const { fires, fireTimes } = simulate(t, start, 7 * DAY)
    expect(fires).toBe(1)
    const target = at(2026, 7, 2, 9, 0)
    expect(fireTimes[0]!).toBeGreaterThanOrEqual(target)
    expect(fireTimes[0]!).toBeLessThanOrEqual(target + 90_000)
  })

  it('重启空档:lastFiredAt=null、enabledAt=三天前,从今天 15:00 起(时刻已过+超宽限)→ 今天不触发,明天 14:30 触发 1 次(不补跑)', () => {
    const t = task({ schedule: { kind: 'daily', time: '14:30' }, lastFiredAt: null, enabledAt: at(2026, 6, 29, 10, 0) })
    // 从今天 15:00 起步进到明天 15:00(约 24h)
    const start = at(2026, 7, 2, 15, 0)
    const { fires, fireTimes } = simulate(t, start, DAY)
    expect(fires).toBe(1) // 今天 14:30 已超宽限不补跑,只在明天 14:30 触发一次
    const tomorrow = at(2026, 7, 3, 14, 30)
    expect(fireTimes[0]!).toBeGreaterThanOrEqual(tomorrow)
    expect(fireTimes[0]!).toBeLessThanOrEqual(tomorrow + 90_000)
  })

  it('interval 30min 模拟 4h:触发 8 次', () => {
    const t = task({ schedule: { kind: 'interval', everyMinutes: 30 }, lastFiredAt: null, enabledAt: at(2026, 7, 2, 10, 0) })
    // 锚点 = enabledAt(10:00);首次到点 10:30。从 10:00 步进 4h → 10:30,11:00,...,14:00 共 8 次
    const start = at(2026, 7, 2, 10, 0)
    const { fires } = simulate(t, start, 4 * HOUR)
    expect(fires).toBe(8)
  })
})
