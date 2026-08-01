// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import AutomationsPanel from '../src/renderer/components/AutomationsPanel'
import AutomationRuns from '../src/renderer/components/AutomationRuns'
import type { AutomationTask, AutomationRun } from '../src/shared/types'

afterEach(() => cleanup())

/**
 * run-now / 审批 都靠 RequestInbox 请守护进程干活。守护进程没运行时后端会撤回请求并回
 * ok=false + reason=gateway-not-running —— UI 必须把这件事说出来。
 * 老行为是静默:点了没反应,而且网关下次启动时那些请求会突然一起执行。
 */
const TASK: AutomationTask = {
  id: 't1', name: '任务测试', prompt: 'p', projectPath: '/proj',
  enabled: true, schedule: { kind: 'interval', everyMinutes: 1 },
  createdAt: 1, enabledAt: 1, lastFiredAt: null,
}
const STABLE_EMPTY = { items: [] as never[] }
let runNowResult: { ok: boolean; reason?: string } = { ok: false, reason: 'gateway-not-running' }
let approvalResult: { ok: boolean; reason?: string } = { ok: false, reason: 'gateway-not-running' }

const WAITING: AutomationRun = {
  runId: 'r1', taskId: 't1', startedAt: 1000,
  status: 'waiting_approval', approvalId: 'task1#1',
} as AutomationRun

beforeEach(() => {
  runNowResult = { ok: false, reason: 'gateway-not-running' }
  approvalResult = { ok: false, reason: 'gateway-not-running' }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  }
  ;(window as unknown as { wraith: unknown }).wraith = {
    automationList: vi.fn(() => Promise.resolve({ tasks: [TASK] })),
    qqPending: vi.fn(() => Promise.resolve(STABLE_EMPTY)),
    automationPanelOpened: vi.fn(() => Promise.resolve()),
    onAutomationEvent: vi.fn(() => () => {}),
    gatewayStatus: vi.fn(() => Promise.resolve({ state: 'stopped' })),
    onGatewayEvent: vi.fn(() => () => {}),
    // 表单是「先保存再跑」(AutomationForm.handleRunNow → saveForRun),缺这个 mock
    // 保存就抛错、onRunNow 根本不会被调到。
    automationUpsert: vi.fn(() => Promise.resolve({ ok: true })),
    automationRunNow: vi.fn(() => Promise.resolve(runNowResult)),
    automationRuns: vi.fn(() => Promise.resolve({ runs: [WAITING] })),
    automationRespondApproval: vi.fn(() => Promise.resolve(approvalResult)),
  }
})

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('立即运行:守护进程未运行时的反馈', () => {
  async function clickRunNow(): Promise<void> {
    render(<AutomationsPanel projects={[]} onBack={vi.fn()} onOpenSession={vi.fn()} onApprove={vi.fn()} />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('automation-run-now')) })
    await settle()
  }

  it('明说没执行、且请求已撤回,不让用户空等', async () => {
    await clickRunNow()
    const hint = screen.getByTestId('runnow-busy-hint').textContent ?? ''
    expect(hint).toContain('网关')
    expect(hint).toContain('未运行')
    expect(hint).not.toBe('任务正在收尾,稍后重试')
  })

  it('其它失败原因仍是「稍后重试」,两种情形不可混为一谈', async () => {
    runNowResult = { ok: false }
    await clickRunNow()
    expect(screen.getByTestId('runnow-busy-hint').textContent).toContain('稍后重试')
  })

  it('成功时不显示任何提示', async () => {
    runNowResult = { ok: true }
    await clickRunNow()
    expect(screen.queryByTestId('runnow-busy-hint')).toBeNull()
  })
})

describe('自动化审批:守护进程未运行时的反馈', () => {
  async function clickApprove(): Promise<void> {
    render(<AutomationRuns taskId="t1" projectPath="/proj" onOpenSession={vi.fn()} onApprove={vi.fn()} />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('automation-run-approve')) })
    await settle()
  }

  it('决定没生效必须说出来 —— 此前是整个丢掉返回值', async () => {
    await clickApprove()
    const banner = screen.getByTestId('approval-not-delivered').textContent ?? ''
    expect(banner).toContain('网关')
    expect(banner).toContain('没有生效')
  })

  it('成功时不出横幅', async () => {
    approvalResult = { ok: true }
    await clickApprove()
    expect(screen.queryByTestId('approval-not-delivered')).toBeNull()
  })
})
