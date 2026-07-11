import { describe, it, expect } from 'vitest'
import { phaseLabel, phaseMeaning, modeLabel, absTime } from '../src/renderer/lib/snapshotView'

describe('phaseLabel', () => {
  it('PRE_TURN → 轮前', () => expect(phaseLabel('PRE_TURN')).toBe('轮前'))
  it('POST_TURN → 轮后', () => expect(phaseLabel('POST_TURN')).toBe('轮后'))
  it('PRE_RESTORE → 恢复前', () => expect(phaseLabel('PRE_RESTORE')).toBe('恢复前'))
  it('未知 → 原值', () => expect(phaseLabel('WHATEVER')).toBe('WHATEVER'))
})

describe('phaseMeaning', () => {
  it('PRE_TURN → 开始前', () => expect(phaseMeaning('PRE_TURN')).toContain('开始前'))
  it('POST_TURN → 结束后', () => expect(phaseMeaning('POST_TURN')).toContain('结束后'))
  it('PRE_RESTORE → 恢复操作前', () => expect(phaseMeaning('PRE_RESTORE')).toContain('恢复操作前'))
})

describe('modeLabel', () => {
  it('plan → 计划模式', () => expect(modeLabel('plan-1783578128576')).toBe('计划模式'))
  it('team → 团队模式', () => expect(modeLabel('team-1783561881530')).toBe('团队模式'))
  it('react → 常规对话', () => expect(modeLabel('react-123')).toBe('常规对话'))
  it('无前缀 → 对话', () => expect(modeLabel('1783578128576')).toBe('对话'))
  it('空 → 对话', () => expect(modeLabel('')).toBe('对话'))
})

describe('absTime', () => {
  it('格式 YYYY-MM-DD HH:mm', () => expect(absTime(1_000_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/))
  it('0 → 空串', () => expect(absTime(0)).toBe(''))
})
