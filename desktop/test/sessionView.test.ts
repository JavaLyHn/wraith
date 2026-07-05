import { describe, it, expect } from 'vitest'
import { sessionDisplayName, partitionStarred } from '../src/renderer/lib/sessionView'
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
