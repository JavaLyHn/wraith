import { describe, it, expect } from 'vitest'
import { scopeLabel, relativeTime } from '../src/renderer/lib/memoryView'

describe('scopeLabel', () => {
  it('project → 项目', () => expect(scopeLabel('project')).toBe('项目'))
  it('global → 全局', () => expect(scopeLabel('global')).toBe('全局'))
  it('未知 → 原值', () => expect(scopeLabel('weird')).toBe('weird'))
})

describe('relativeTime', () => {
  const now = 1_000_000_000_000
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

  it('未来/同刻 → 刚刚', () => {
    expect(relativeTime(now, now)).toBe('刚刚')
    expect(relativeTime(now + 5000, now)).toBe('刚刚')
  })
  it('分钟级', () => expect(relativeTime(now - 5 * MIN, now)).toBe('5 分钟前'))
  it('小时级', () => expect(relativeTime(now - 3 * HOUR, now)).toBe('3 小时前'))
  it('天级(<7天)', () => expect(relativeTime(now - 2 * DAY, now)).toBe('2 天前'))
  it('超 7 天 → 绝对日期 YYYY-MM-DD', () => {
    const s = relativeTime(now - 30 * DAY, now)
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
