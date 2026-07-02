import { describe, it, expect } from 'vitest'
import { detectMention, filterMentionItems, insertMention } from '../src/shared/mentionTrigger'
import type { McpResourceView } from '../src/shared/types'

const RES: McpResourceView[] = [
  { server: 'github', uri: 'issue://1', name: 'Issue 1' },
  { server: 'github', uri: 'pr://2', name: 'PR 2', description: 'desc' },
  { server: 'fs', uri: 'file:///a.txt', name: 'a.txt' },
]

describe('detectMention', () => {
  it('行首/空白后的 @ 激活,取 @ 到光标为 query', () => {
    expect(detectMention('@gi', 3)).toEqual({ active: true, start: 0, query: 'gi' })
    expect(detectMention('查 @github:is 的', 13)).toEqual({ active: true, start: 2, query: 'github:is' })
  })
  it('非空白前缀的 @ 不激活(邮箱等)', () => {
    expect(detectMention('a@b', 3).active).toBe(false)
  })
  it('query 含空白即失活', () => {
    expect(detectMention('@gi hub', 7).active).toBe(false)
  })
  it('无 @ 不激活', () => {
    expect(detectMention('hello', 5).active).toBe(false)
  })
})

describe('filterMentionItems', () => {
  it('无冒号:按前缀滤 server,一级列表(去重)', () => {
    const items = filterMentionItems(RES, 'gi')
    expect(items).toHaveLength(1)
    expect(items[0]!.insert).toBe('@github:')
    expect(items[0]!.label).toBe('github')
  })
  it('有冒号:列该 server 的资源,按 uri/name 前缀滤', () => {
    const items = filterMentionItems(RES, 'github:is')
    expect(items).toHaveLength(1)
    expect(items[0]!.insert).toBe('@github:issue://1 ')
  })
  it('空 query 列全部 server', () => {
    expect(filterMentionItems(RES, '').map(i => i.label)).toEqual(['github', 'fs'])
  })
})

describe('insertMention', () => {
  it('替换 @..光标 段为 insert,光标落在其后', () => {
    const r = insertMention('查 @github:is 的', { active: true, start: 2, query: 'github:is' }, '@github:issue://1 ')
    expect(r.next).toBe('查 @github:issue://1  的')
    expect(r.caret).toBe(2 + '@github:issue://1 '.length)
  })
})
