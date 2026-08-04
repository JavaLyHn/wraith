import { describe, it, expect } from 'vitest'
import { argsView, hasArgs } from '../src/renderer/lib/toolArgsView'

/**
 * 审批弹窗里参数区的形态。
 *
 * 用户实测:批准 `mcp__memory__list_resources` 时,弹窗里挂着一个**空的大框**,
 * 占掉四分之一个对话框却什么都没写。那个工具用的是 emptyObjectSchema() ——
 * 它压根没有参数,模型送的是 `{}`。
 *
 * **纪律:绝不隐藏任何键。** 审批弹窗的全部意义就是「让用户看清将要执行什么」,
 * 为了好看而藏掉一个参数,是把可读性换成了安全性。
 * 所以对「值为空」的处理是**显式标出来**(`(空)`)而不是丢掉 —— 那是多给信息,不是少给。
 * 只有「压根没有参数」这一种情况才收起整个框,因为那时确实没有信息可丢。
 */

describe('argsView', () => {
  it('{} → 无参数,不需要框', () => {
    expect(argsView('{}').kind).toBe('none')
  })

  it('空串 / 空白 / null 字面量都算无参数', () => {
    expect(argsView('').kind).toBe('none')
    expect(argsView('   ').kind).toBe('none')
    expect(argsView('null').kind).toBe('none')
  })

  it('有参数 → 逐行键值,而不是一坨 JSON', () => {
    const v = argsView('{"path":"src/a.ts","recursive":true}')
    expect(v.kind).toBe('rows')
    expect(v.rows).toEqual([
      { key: 'path', display: 'src/a.ts', empty: false },
      { key: 'recursive', display: 'true', empty: false },
    ])
  })

  it('值为空的键**照样列出来**,只是标成「(空)」—— 藏掉它等于让用户盲批', () => {
    const v = argsView('{"path":"","recursive":true}')
    expect(v.rows.map(r => r.key)).toEqual(['path', 'recursive'])
    const path = v.rows.find(r => r.key === 'path')!
    expect(path.empty).toBe(true)
    expect(path.display).toBe('(空)')
  })

  it('null / 空数组 / 空对象都算空值', () => {
    const v = argsView('{"a":null,"b":[],"c":{},"d":""}')
    expect(v.rows.every(r => r.empty)).toBe(true)
    expect(v.rows.map(r => r.key)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('0 与 false 不是空 —— 它们是实实在在的取值', () => {
    const v = argsView('{"limit":0,"force":false}')
    expect(v.rows.map(r => [r.key, r.display, r.empty]))
      .toEqual([['limit', '0', false], ['force', 'false', false]])
  })

  it('非空数组 / 对象压成紧凑 JSON 一行', () => {
    const v = argsView('{"paths":["a","b"],"opts":{"deep":true}}')
    expect(v.rows[0].display).toBe('["a","b"]')
    expect(v.rows[1].display).toBe('{"deep":true}')
  })

  it('多行字符串保持原样(由渲染层决定怎么排),不被截断', () => {
    const v = argsView('{"content":"line1\\nline2"}')
    expect(v.rows[0].display).toBe('line1\nline2')
  })

  it('非法 JSON → 原样兜底,绝不吞掉 —— 那种情况用户更需要看到原文', () => {
    const v = argsView('{not json')
    expect(v.kind).toBe('raw')
    expect(v.raw).toBe('{not json')
  })

  it('顶层不是对象(数组 / 标量)也走原样兜底', () => {
    expect(argsView('[1,2]').kind).toBe('raw')
    expect(argsView('"hello"').kind).toBe('raw')
    expect(argsView('42').kind).toBe('raw')
  })

  it('全是空值的对象仍然是 rows 而不是 none —— 「送了两个空参数」与「没有参数」是两件事', () => {
    const v = argsView('{"uri":"","cursor":""}')
    expect(v.kind).toBe('rows')
    expect(v.rows).toHaveLength(2)
  })
})

describe('hasArgs（工具卡用）', () => {
  it('{} / 空串 / null 都算没有参数', () => {
    expect(hasArgs('{}')).toBe(false)
    expect(hasArgs('')).toBe(false)
    expect(hasArgs('null')).toBe(false)
  })

  it('有键就算有 —— 哪怕值全是空的', () => {
    expect(hasArgs('{"uri":""}')).toBe(true)
  })

  it('非法 JSON 算有 —— 那种情况必须让用户看到原文', () => {
    expect(hasArgs('{not json')).toBe(true)
  })
})
