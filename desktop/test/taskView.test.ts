import { describe, it, expect } from 'vitest'
import { taskStatusLabel, taskStatusTone, taskIsTerminal, formatDuration, taskPromptSummary } from '../src/renderer/lib/taskView'

describe('taskStatusLabel', () => {
  it('各状态映射', () => {
    expect(taskStatusLabel('enqueued')).toBe('排队中')
    expect(taskStatusLabel('running')).toBe('运行中')
    expect(taskStatusLabel('completed')).toBe('已完成')
    expect(taskStatusLabel('failed')).toBe('失败')
    expect(taskStatusLabel('canceled')).toBe('已取消')
  })
  it('未知 → 原值', () => expect(taskStatusLabel('weird')).toBe('weird'))
})

describe('taskStatusTone', () => {
  it('completed → ok', () => expect(taskStatusTone('completed')).toBe('ok'))
  it('failed → danger', () => expect(taskStatusTone('failed')).toBe('danger'))
  it('running → running', () => expect(taskStatusTone('running')).toBe('running'))
  it('未知 → muted', () => expect(taskStatusTone('x')).toBe('muted'))
})

describe('taskIsTerminal', () => {
  it('completed/failed/canceled 终态', () => {
    expect(taskIsTerminal('completed')).toBe(true)
    expect(taskIsTerminal('failed')).toBe(true)
    expect(taskIsTerminal('canceled')).toBe(true)
  })
  it('enqueued/running 非终态', () => {
    expect(taskIsTerminal('enqueued')).toBe(false)
    expect(taskIsTerminal('running')).toBe(false)
  })
})

describe('formatDuration', () => {
  it('毫秒', () => expect(formatDuration(850)).toBe('850ms'))
  it('秒', () => expect(formatDuration(42_000)).toBe('42s'))
  it('分', () => expect(formatDuration(180_000)).toBe('3m'))
  it('分秒', () => expect(formatDuration(200_000)).toBe('3m20s'))
  it('0/负 → 空', () => { expect(formatDuration(0)).toBe(''); expect(formatDuration(-1)).toBe('') })
})

describe('taskPromptSummary', () => {
  it('压平多行空白', () => expect(taskPromptSummary('a\n  b\tc')).toBe('a b c'))
  it('超长截断', () => expect(taskPromptSummary('x'.repeat(100)).endsWith('…')).toBe(true))
  it('短的原样', () => expect(taskPromptSummary('hi')).toBe('hi'))
})
