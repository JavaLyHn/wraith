import { describe, it, expect } from 'vitest'
import { outcomeLabel, approverLabel, formatAuditTime } from '../src/renderer/lib/policyView'

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
