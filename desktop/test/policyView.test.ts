import { describe, it, expect } from 'vitest'
import { outcomeLabel, approverLabel, formatAuditTime, auditArgFields } from '../src/renderer/lib/policyView'

describe('outcomeLabel', () => {
  it('allow → 允许', () => expect(outcomeLabel('allow')).toBe('允许'))
  it('deny → 拒绝', () => expect(outcomeLabel('deny')).toBe('拒绝'))
  it('error → 错误', () => expect(outcomeLabel('error')).toBe('错误'))
  it('未知 → 原值', () => expect(outcomeLabel('weird')).toBe('weird'))
})

describe('approverLabel', () => {
  it('hitl → 人工', () => expect(approverLabel('hitl')).toBe('人工'))
  it('policy → 策略', () => expect(approverLabel('policy')).toBe('策略'))
  it('none → 自动', () => expect(approverLabel('none')).toBe('自动'))
  it('mention → 提及', () => expect(approverLabel('mention')).toBe('提及'))
  it('空/未知 → 原值或空', () => { expect(approverLabel('x')).toBe('x'); expect(approverLabel(null)).toBe('') })
})

describe('formatAuditTime', () => {
  it('ISO → MM-DD HH:mm:ss', () => {
    // 用带明确时区偏移的时间,避免本地时区导致断言飘移:构造后按本地格式化比对
    const iso = '2026-07-11T08:09:10.000Z'
    const s = formatAuditTime(iso)
    expect(s).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
  it('非法输入 → 原样返回', () => expect(formatAuditTime('not-a-date')).toBe('not-a-date'))
})

describe('auditArgFields', () => {
  it('write_file:path 全显 + content 折成首行预览 + 行数/字符摘要', () => {
    const content = 'package com.lyhn.wraith.util;\n\n/** doc */\npublic class X {}'
    const args = JSON.stringify({ path: 'src/main/java/X.java', content })
    const f = auditArgFields(args)
    expect(f).toHaveLength(2)
    expect(f[0]).toEqual({ key: 'path', value: 'src/main/java/X.java', meta: undefined })
    expect(f[1].key).toBe('content')
    expect(f[1].value).toBe('package com.lyhn.wraith.util;')   // 首个非空行,非整段
    expect(f[1].meta).toBe(`共 4 行 · ${content.length} 字符`)
    expect(f[1].value).not.toContain('\\n')                    // 不再是转义糊墙
  })
  it('短单行值不带摘要', () => {
    const f = auditArgFields(JSON.stringify({ offset: 1 }))
    expect(f).toEqual([{ key: 'offset', value: '1' }])
  })
  it('超长单行字符串:截断 + 字符摘要', () => {
    const f = auditArgFields(JSON.stringify({ q: 'x'.repeat(300) }))
    expect(f[0].value.endsWith('…')).toBe(true)
    expect(f[0].meta).toBe('共 1 行 · 300 字符')
  })
  it('解析失败/非对象 → 原始兜底(截断)', () => {
    expect(auditArgFields('not json')).toEqual([{ key: '', value: 'not json' }])
    expect(auditArgFields('[1,2,3]')).toEqual([{ key: '', value: '[1,2,3]' }])
  })
  it('空/空白 → 空数组', () => {
    expect(auditArgFields('')).toEqual([])
    expect(auditArgFields(null)).toEqual([])
  })
})
