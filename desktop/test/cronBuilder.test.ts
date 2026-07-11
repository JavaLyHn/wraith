import { describe, it, expect } from 'vitest'
import { buildCron, parseCron, describeCron, CRON_DEFAULT_STATE, type CronBuilderState } from '../src/renderer/lib/cronBuilder'

const st = (over: Partial<CronBuilderState>): CronBuilderState => ({ ...CRON_DEFAULT_STATE, ...over })

describe('buildCron', () => {
  it('hourly → 第 N 分', () => {
    expect(buildCron(st({ mode: 'hourly', minute: 30 }))).toBe('30 * * * *')
  })
  it('everyNHours → 0 */N * * *', () => {
    expect(buildCron(st({ mode: 'everyNHours', everyN: 3 }))).toBe('0 */3 * * *')
  })
  it('monthly → mi h D * *', () => {
    expect(buildCron(st({ mode: 'monthly', monthDay: 15, time: '08:05' }))).toBe('5 8 15 * *')
  })
  it('weekdays → mi h * * 1-5', () => {
    expect(buildCron(st({ mode: 'weekdays', time: '09:30' }))).toBe('30 9 * * 1-5')
  })
  it('raw → 原样去空白', () => {
    expect(buildCron(st({ mode: 'raw', raw: '  */5 * * * *  ' }))).toBe('*/5 * * * *')
  })
  it('越界值被夹紧', () => {
    expect(buildCron(st({ mode: 'hourly', minute: 99 }))).toBe('59 * * * *')
    expect(buildCron(st({ mode: 'everyNHours', everyN: 0 }))).toBe('0 */1 * * *')
    expect(buildCron(st({ mode: 'monthly', monthDay: 40, time: '09:00' }))).toBe('0 9 31 * *')
  })
})

describe('parseCron (反解，可编辑回显)', () => {
  it('每小时', () => {
    const s = parseCron('30 * * * *')
    expect(s.mode).toBe('hourly'); expect(s.minute).toBe(30)
  })
  it('每 N 小时', () => {
    const s = parseCron('0 */6 * * *')
    expect(s.mode).toBe('everyNHours'); expect(s.everyN).toBe(6)
  })
  it('每月某天', () => {
    const s = parseCron('5 8 15 * *')
    expect(s.mode).toBe('monthly'); expect(s.monthDay).toBe(15); expect(s.time).toBe('08:05')
  })
  it('工作日', () => {
    const s = parseCron('30 9 * * 1-5')
    expect(s.mode).toBe('weekdays'); expect(s.time).toBe('09:30')
  })
  it('未命中形态 → raw，原样保留', () => {
    const s = parseCron('0 9 * * 1,3,5')
    expect(s.mode).toBe('raw'); expect(s.raw).toBe('0 9 * * 1,3,5')
  })
  it('round-trip:build∘parse 不变(常见形态)', () => {
    for (const expr of ['30 * * * *', '0 */3 * * *', '5 8 15 * *', '30 9 * * 1-5']) {
      expect(buildCron(parseCron(expr))).toBe(expr)
    }
  })
})

describe('describeCron', () => {
  it('各模式给出中文描述', () => {
    expect(describeCron(st({ mode: 'hourly', minute: 0 }))).toContain('每小时')
    expect(describeCron(st({ mode: 'everyNHours', everyN: 2 }))).toContain('每隔 2 小时')
    expect(describeCron(st({ mode: 'monthly', monthDay: 1, time: '09:00' }))).toContain('每月 1 号')
    expect(describeCron(st({ mode: 'weekdays', time: '09:00' }))).toContain('工作日')
    expect(describeCron(st({ mode: 'raw', raw: 'x' }))).toContain('自定义')
  })
})
