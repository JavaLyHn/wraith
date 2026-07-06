import { describe, it, expect } from 'vitest'
import { parseTagsInput, validateSkillName, toUpsertPayload } from '../src/renderer/lib/skillEditor'

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
      author: 'me', tagsInput: 'x, y, x', body: 'B',
    })
    expect(payload).toEqual({
      scope: 'user', name: 'mine', description: 'd', version: '1',
      author: 'me', tags: ['x', 'y'], body: 'B',
    })
  })
})
