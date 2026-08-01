import type { AutomationTask } from '../src/shared/types'
import { describe, expect, it } from 'vitest'
import { taskStatusLabel, nextRunSubLabel, gatewayPillView } from '../src/renderer/lib/gatewayGate'
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
  it('running → ok + stop 按钮', () => {
    expect(gatewayPillView({ state: 'running' })).toEqual({ text: '网关运行中', tone: 'ok', action: 'stop' })
  })
  it('starting → muted + stop 按钮', () => {
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

// ---------------------------------------------------------------------------
// 列表副标签:网关没跑时不许显示「下次 HH:mm」
// ---------------------------------------------------------------------------
// 调度器活在 GatewayDaemon 里。网关没起 = 任务根本不会执行,此时报一个具体时刻
// 是纯粹的谎话 —— 用户真机上就是这样:任务停在「下次 16:17」,而它从创建起
// 35 分钟一次都没跑过。要等网关 running 才给时间。
describe('nextRunSubLabel', () => {
  const ENABLED_AT = new Date(2026, 7, 1, 16, 16).getTime()
  const NOW = ENABLED_AT + 35 * 60_000
  const t = (over: Partial<AutomationTask> = {}): AutomationTask => ({
    id: 't1', name: 'n', prompt: 'p', projectPath: '/p',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 1 },
    createdAt: ENABLED_AT, enabledAt: ENABLED_AT, lastFiredAt: null, ...over,
  })

  it('网关 running:给出真实的下次时刻', () => {
    expect(nextRunSubLabel(t(), 'running', NOW)).toBe('下次 08-01 16:52')
  })

  for (const state of ['stopped', 'starting', 'error'] as const) {
    it(`网关 ${state}:一个时刻都不许出现`, () => {
      const label = nextRunSubLabel(t(), state, NOW)
      expect(label).not.toMatch(/下次/)
      expect(label).not.toMatch(/\d{2}:\d{2}/)
    })
  }

  it('网关未运行时说明原因,而不是含糊留白', () => {
    expect(nextRunSubLabel(t(), 'stopped', NOW)).toContain('网关未运行')
  })

  it('启动中单独措辞(马上就有时间了,别让人以为坏了)', () => {
    expect(nextRunSubLabel(t(), 'starting', NOW)).toContain('启动中')
  })

  it('任务已暂停:优先于网关状态', () => {
    expect(nextRunSubLabel(t({ enabled: false }), 'running', NOW)).toBe('已暂停')
    expect(nextRunSubLabel(t({ enabled: false }), 'stopped', NOW)).toBe('已暂停')
  })
})
