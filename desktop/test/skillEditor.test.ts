import { describe, it, expect } from 'vitest'
import { parseTagsInput, validateSkillName, toUpsertPayload, scopeToCleanup, normalizeReferences } from '../src/renderer/lib/skillEditor'

describe('parseTagsInput', () => {
  it('逗号/换行分隔,trim,去空,去重保序', () => {
    expect(parseTagsInput('a, b\n c ,a,')).toEqual(['a', 'b', 'c'])
  })
  it('空输入返回空数组', () => {
    expect(parseTagsInput('  ')).toEqual([])
  })
})

describe('validateSkillName', () => {
  it('合法名返回 null', () => {
    expect(validateSkillName('web-access_1')).toBeNull()
  })
  it('空名报错', () => {
    expect(validateSkillName('')).not.toBeNull()
    expect(validateSkillName('   ')).not.toBeNull()
  })
  it.each(['../x', 'a/b', 'a b', 'a.b', '中文'])('拒非法名 %s', (bad) => {
    expect(validateSkillName(bad)).not.toBeNull()
  })
})

describe('toUpsertPayload', () => {
  it('表单态映射为载荷,tags 解析,name trim', () => {
    const payload = toUpsertPayload({
      scope: 'user', name: '  mine  ', description: 'd', version: '1',
      author: 'me', tagsInput: 'x, y, x', body: 'B', references: [],
    })
    expect(payload).toEqual({
      scope: 'user', name: 'mine', description: 'd', version: '1',
      author: 'me', tags: ['x', 'y'], body: 'B', references: [],
    })
  })
})

describe('normalizeReferences', () => {
  it('trim path、去空 path、去前导斜杠', () => {
    expect(normalizeReferences([
      { path: '  a.md ', content: 'A' },
      { path: '', content: 'skip' },
      { path: '/site/b.md', content: 'B' },
    ])).toEqual([
      { path: 'a.md', content: 'A' },
      { path: 'site/b.md', content: 'B' },
    ])
  })
  it('同 path 去重(后者胜)', () => {
    expect(normalizeReferences([
      { path: 'x.md', content: '1' },
      { path: 'x.md', content: '2' },
    ])).toEqual([{ path: 'x.md', content: '2' }])
  })
  it('undefined → 空数组', () => {
    expect(normalizeReferences(undefined as unknown as never[])).toEqual([])
  })
})

describe('scopeToCleanup', () => {
  it('同作用域(未移动)→null', () => {
    expect(scopeToCleanup('user', 'user')).toBeNull()
    expect(scopeToCleanup('project', 'project')).toBeNull()
  })
  it('跨作用域→返回旧 scope(要删的)', () => {
    expect(scopeToCleanup('project', 'user')).toBe('project')
    expect(scopeToCleanup('user', 'project')).toBe('user')
  })
  it('builtin/undefined 源→null(不删)', () => {
    expect(scopeToCleanup('builtin', 'user')).toBeNull()
    expect(scopeToCleanup(undefined, 'user')).toBeNull()
  })
})
