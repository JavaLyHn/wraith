import { describe, it, expect } from 'vitest'
import { phaseLabel, phaseMeaning, modeLabel, absTime, relativeTime, summaryInput } from '../src/renderer/lib/snapshotView'

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

describe('relativeTime', () => {
  const now = 1_000_000_000_000
  it('< 1 分钟 → 刚刚', () => expect(relativeTime(now - 30_000, now)).toBe('刚刚'))
  it('分钟级', () => expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前'))
  it('小时级', () => expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 小时前'))
  it('天级', () => expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前'))
  it('月级', () => expect(relativeTime(now - 60 * 86_400_000, now)).toBe('2 个月前'))
  it('0 → 空串', () => expect(relativeTime(0, now)).toBe(''))
})

describe('summaryInput', () => {
  it('提取 input 段', () => expect(summaryInput('mode=team\ninput=帮我改下登录逻辑')).toBe('帮我改下登录逻辑'))
  it('去首尾空白', () => expect(summaryInput('mode=plan\ninput=  加个缓存  ')).toBe('加个缓存'))
  it('无 input 段 → 空串', () => expect(summaryInput('mode=react')).toBe(''))
  it('空 → 空串', () => expect(summaryInput('')).toBe(''))
})
