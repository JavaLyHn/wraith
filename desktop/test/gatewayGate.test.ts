import { describe, expect, it } from 'vitest'
import { taskStatusLabel, gatewayPillView } from '../src/renderer/lib/gatewayGate'
import type { GatewayState } from '../src/shared/gateway'

describe('taskStatusLabel', () => {
  it('未启用 → 已暂停(与网关态无关)', () => {
    for (const s of ['stopped', 'starting', 'running', 'error'] as GatewayState[]) {
      expect(taskStatusLabel(false, s)).toBe('⏸ 已暂停')
    }
  })
  it('启用 + 网关运行中 → 运行中', () => {
    expect(taskStatusLabel(true, 'running')).toBe('● 运行中')
  })
  it('启用 + 网关非运行 → 已启用·网关未运行', () => {
    for (const s of ['stopped', 'starting', 'error'] as GatewayState[]) {
      expect(taskStatusLabel(true, s)).toBe('已启用 · 网关未运行')
    }
  })
})

describe('gatewayPillView', () => {
  it('running → ok 无按钮', () => {
    expect(gatewayPillView({ state: 'running' })).toEqual({ text: '网关运行中', tone: 'ok', action: 'stop' })
  })
  it('starting → muted 无按钮', () => {
    expect(gatewayPillView({ state: 'starting' })).toEqual({ text: '网关启动中…', tone: 'muted', action: 'stop' })
  })
  it('stopped → warn + start + hint', () => {
    const v = gatewayPillView({ state: 'stopped' })
    expect(v.tone).toBe('warn'); expect(v.action).toBe('start')
    expect(v.text).toBe('网关未运行'); expect(v.hint).toBe('启动后会连上已绑定的 QQ/飞书/微信')
  })
  it('error → err + retry + 带 message 摘要 + hint', () => {
    const v = gatewayPillView({ state: 'error', message: '认证失败' })
    expect(v.tone).toBe('err'); expect(v.action).toBe('retry')
    expect(v.text).toBe('网关异常 · 认证失败'); expect(v.hint).toBe('启动后会连上已绑定的 QQ/飞书/微信')
  })
  it('error 无 message → 只显示网关异常', () => {
    expect(gatewayPillView({ state: 'error' }).text).toBe('网关异常')
  })
})
