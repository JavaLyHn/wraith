import { describe, it, expect } from 'vitest'
import { computeNextRunLabel } from '../src/renderer/lib/automationLabels'
import type { AutomationTask } from '../src/shared/types'

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 't1', name: 'test', prompt: 'p', projectPath: '/proj',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 10 },
    createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
    ...over,
  }
}

describe('computeNextRunLabel', () => {
  it('lastFiredAt===null && enabledAt===0 → 待触发兜底', () => {
    expect(computeNextRunLabel(task({ lastFiredAt: null, enabledAt: 0 }))).toBe('待触发')
  })

  it('正常任务返回「下次 MM-DD HH:mm」格式', () => {
    const label = computeNextRunLabel(task({ enabledAt: Date.now(), lastFiredAt: null }))
    expect(label).toMatch(/^下次 \d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
