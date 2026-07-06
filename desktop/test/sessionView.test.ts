import { describe, it, expect } from 'vitest'
import { sessionDisplayName, partitionStarred, groupSessionsByTime } from '../src/renderer/lib/sessionView'
import type { SessionMeta } from '../src/shared/types'

function s(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'i', cwd: '/p', createdAt: 't', updatedAt: 't',
    provider: 'deepseek', model: 'm', title: '自动标题', turns: 1, ...over,
  }
}

describe('sessionDisplayName', () => {
  it('有 name 用 name', () => expect(sessionDisplayName(s({ name: '部署脚本' }))).toBe('部署脚本'))
  it('name 空白回落 title', () => expect(sessionDisplayName(s({ name: '  ' }))).toBe('自动标题'))
  it('无 name 用 title', () => expect(sessionDisplayName(s())).toBe('自动标题'))
  it('都无 → (未命名)', () => expect(sessionDisplayName(s({ title: '' }))).toBe('(未命名)'))
})

describe('partitionStarred', () => {
  it('按 starred 拆分并保序', () => {
    const a = s({ id: 'a' }), b = s({ id: 'b', starred: true }), c = s({ id: 'c' }), d = s({ id: 'd', starred: true })
    const { starred, rest } = partitionStarred([a, b, c, d])
    expect(starred.map(x => x.id)).toEqual(['b', 'd'])
    expect(rest.map(x => x.id)).toEqual(['a', 'c'])
  })
  it('无 starred 时 starred 为空', () => {
    const { starred, rest } = partitionStarred([s({ id: 'a' })])
    expect(starred).toEqual([])
    expect(rest.map(x => x.id)).toEqual(['a'])
  })
})

describe('groupSessionsByTime', () => {
  const now = new Date('2026-07-06T12:00:00').getTime() // 本地正午,避免跨午夜边界
  const at = (daysAgo: number, id: string): SessionMeta =>
    s({ id, updatedAt: new Date(now - daysAgo * 86400000).toISOString() })

  it('按日历天差分档,组序固定,组内取首条对应各档', () => {
    const groups = groupSessionsByTime([at(0, 'today'), at(1, 'yday'), at(3, 'wk'), at(10, 'mo'), at(40, 'old')], now)
    expect(groups.map(g => g.label)).toEqual(['今天', '昨天', '近7天', '近30天', '更早'])
    expect(groups.map(g => g.sessions[0].id)).toEqual(['today', 'yday', 'wk', 'mo', 'old'])
  })

  it('空档省略,只返回有会话的组', () => {
    const groups = groupSessionsByTime([at(0, 'a'), at(40, 'b')], now)
    expect(groups.map(g => g.label)).toEqual(['今天', '更早'])
  })

  it('组内保持传入顺序', () => {
    const groups = groupSessionsByTime([at(0, 'a1'), at(0, 'a2'), at(3, 'w1')], now)
    expect(groups[0].sessions.map(x => x.id)).toEqual(['a1', 'a2'])
  })

  it('边界:1=昨天,6=近7天,7/29=近30天,30=更早', () => {
    const groups = groupSessionsByTime([at(1, 'd1'), at(6, 'd6'), at(7, 'd7'), at(29, 'd29'), at(30, 'd30')], now)
    const labelOf = (id: string): string => groups.find(g => g.sessions.some(x => x.id === id))!.label
    expect(labelOf('d1')).toBe('昨天')
    expect(labelOf('d6')).toBe('近7天')
    expect(labelOf('d7')).toBe('近30天')
    expect(labelOf('d29')).toBe('近30天')
    expect(labelOf('d30')).toBe('更早')
  })

  it('未来时间(时钟偏差)归今天', () => {
    const groups = groupSessionsByTime([at(-1, 'future')], now)
    expect(groups[0].label).toBe('今天')
  })

  it('空输入返回空数组', () => {
    expect(groupSessionsByTime([], now)).toEqual([])
  })
})
