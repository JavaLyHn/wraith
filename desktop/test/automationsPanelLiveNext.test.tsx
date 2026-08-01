// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import AutomationsPanel from '../src/renderer/components/AutomationsPanel'
import type { AutomationTask } from '../src/shared/types'

afterEach(() => { cleanup(); vi.useRealTimers() })

// 每分钟一次、从未触发过(守护进程没起)—— 正是用户报的场景。
const ENABLED_AT = new Date(2026, 7, 1, 16, 16).getTime()
const TASK: AutomationTask = {
  id: 't1', name: '任务测试', prompt: 'p', projectPath: '/proj',
  enabled: true, schedule: { kind: 'interval', everyMinutes: 1 },
  createdAt: ENABLED_AT, enabledAt: ENABLED_AT, lastFiredAt: null,
}

const STABLE_EMPTY = { items: [] as never[] }

beforeEach(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  }
  ;(window as unknown as { wraith: unknown }).wraith = {
    automationList: vi.fn(() => Promise.resolve({ tasks: [TASK] })),
    // ⚠ 必须每次返回**同一个数组引用**。面板里有个 6s 的 qqPending 轮询,若每次给新 []，
    // setQqPending 引用一变就重渲染,会把 ticker 的作用完全掩盖 —— 本测试就成了恒真的
    // (实测:拆掉 ticker 仍全绿)。同引用时 React 以 Object.is 短路,不重渲染。
    qqPending: vi.fn(() => Promise.resolve(STABLE_EMPTY)),
    automationPanelOpened: vi.fn(() => Promise.resolve()),
    onAutomationEvent: vi.fn(() => () => {}),
    gatewayStatus: vi.fn(() => Promise.resolve({ state: 'stopped' })),
    onGatewayEvent: vi.fn(() => () => {}),
  }
})

async function mountAt(when: number): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(when)
  render(<AutomationsPanel projects={[]} onBack={vi.fn()} onOpenSession={vi.fn()} onApprove={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function nextLabel(): string {
  return screen.getByText(/^下次 /).textContent ?? ''
}

describe('自动化面板「下次」实时性', () => {
  it('挂载时显示的是 now 之后的时刻,不是创建时刻+一周期那个过去的点', async () => {
    await mountAt(ENABLED_AT + 35 * 60_000)   // 16:51
    expect(nextLabel()).toBe('下次 08-01 16:52')
    expect(nextLabel()).not.toBe('下次 08-01 16:17')   // 用户截图里那个冻住的值
  })

  it('时间流逝后标签自己走字(不依赖任何后端事件)', async () => {
    await mountAt(ENABLED_AT + 35 * 60_000)
    expect(nextLabel()).toBe('下次 08-01 16:52')

    // 只推进时间,不发 runs-changed —— 任务从没触发过,本来就没有事件可发。
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(nextLabel()).toBe('下次 08-01 16:53')

    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(nextLabel()).toBe('下次 08-01 16:55')
  })
})
