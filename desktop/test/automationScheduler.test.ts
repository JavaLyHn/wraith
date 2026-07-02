import { describe, it, expect } from 'vitest'
import { decideTick } from '../src/main/automationScheduler'
import type { AutomationTask } from '../src/shared/types'

function t(id: string, over: Partial<AutomationTask> = {}): AutomationTask {
  return { id, name: id, prompt: 'p', projectPath: '/p', enabled: true,
    schedule: { kind: 'interval', everyMinutes: 10 }, createdAt: 0, enabledAt: 0, lastFiredAt: null, ...over }
}
const MIN = 60_000

describe('decideTick', () => {
  it('到点且空闲 → fire 一个,其余到点者排队', () => {
    const d = decideTick([t('a'), t('b')], 11 * MIN, null, [], new Set())
    expect(d.fire).toEqual(['a'])
    expect(d.enqueue).toEqual(['b'])
    expect(d.miss).toEqual([])
  })

  it('未到点不动;disabled 不动', () => {
    const d = decideTick([t('a', { lastFiredAt: 5 * MIN }), t('b', { enabled: false })], 11 * MIN, null, [], new Set())
    expect(d).toEqual({ fire: [], enqueue: [], miss: [] })
  })

  it('全局有运行中 → 到点者排队;已在队列 → miss', () => {
    const d = decideTick([t('a'), t('b')], 11 * MIN, 'other', ['b'], new Set())
    expect(d.fire).toEqual([])
    expect(d.enqueue).toEqual(['a'])
    expect(d.miss).toEqual(['b'])
  })

  it('同任务 active(running/waiting) → miss 不触发', () => {
    const d = decideTick([t('a')], 11 * MIN, null, [], new Set(['a']))
    expect(d.miss).toEqual(['a'])
    expect(d.fire).toEqual([])
  })
})
