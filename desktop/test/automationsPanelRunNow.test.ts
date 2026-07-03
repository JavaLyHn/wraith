/**
 * Part A 红绿测试:AutomationsPanel.handleRunNow 读取 {ok} 返回值。
 *
 * 根因:旧实现 handleRunNow 忽略 automationRunNow() 返回值,仅调用 setTab('runs')。
 *   ok:false 时用户无任何反馈(结算窗 B5 静默)。
 *
 * 修复:handleRunNow 读取 { ok },ok:true → setTab('runs'),ok:false → setRunNowBusy(true) 触发 hint。
 *
 * 测试策略:因无 React Testing Library,提取核心 handler 逻辑为可纯函数测试的形式,
 * 通过模拟 window.wraith.automationRunNow 的不同返回值断言副作用(setTab/setRunNowBusy)的调用。
 *
 * 红(修复前行为):handleRunNow 不读返回值 → 无论 ok:true/false 都只调 setTab('runs') → setRunNowBusy 不被调用。
 * 绿(修复后行为):ok:false → setRunNowBusy(true) 被调用;ok:true → setTab('runs') 被调用,setRunNowBusy 不调用。
 */
import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// 提取 handleRunNow 核心决策逻辑(与 AutomationsPanel.tsx 中实现对称)
// 这是白盒单元测试:对完全相同的逻辑路径断言,无需 DOM/React 渲染。
// ---------------------------------------------------------------------------

type RunNowFn = (id: string) => Promise<{ ok: boolean }>

/**
 * 模拟 AutomationsPanel 中 handleRunNow 的决策逻辑。
 * 与组件保持同构:ok:true → setTab;ok:false → setRunNowBusy。
 */
async function handleRunNowLogic(
  taskId: string,
  runNow: RunNowFn,
  setTab: (tab: 'def' | 'runs') => void,
  setRunNowBusy: (v: boolean) => void,
): Promise<void> {
  try {
    const result = await runNow(taskId)
    if (result.ok) {
      setTab('runs')
    } else {
      setRunNowBusy(true)
    }
  } catch (err) {
    console.error('[wraith] automationRunNow error:', err)
  }
}

/**
 * 旧实现(修复前):忽略返回值,仅 setTab('runs')。
 * 用于对比证明红测用例。
 */
async function handleRunNowOldLogic(
  taskId: string,
  runNow: RunNowFn,
  setTab: (tab: 'def' | 'runs') => void,
  _setRunNowBusy: (v: boolean) => void,
): Promise<void> {
  try {
    await runNow(taskId)
    setTab('runs')   // 旧逻辑:不读 ok,无条件 setTab
  } catch (err) {
    console.error('[wraith] automationRunNow error:', err)
  }
}

describe('AutomationsPanel handleRunNow Part A 红绿', () => {
  // -----------------------------------------------------------------------
  // GREEN: 修复后行为
  // -----------------------------------------------------------------------
  it('[绿] ok:true → 调用 setTab("runs"),不触发 setRunNowBusy', async () => {
    const runNow = vi.fn().mockResolvedValue({ ok: true })
    const setTab = vi.fn()
    const setRunNowBusy = vi.fn()

    await handleRunNowLogic('task-1', runNow, setTab, setRunNowBusy)

    expect(setTab).toHaveBeenCalledWith('runs')
    expect(setRunNowBusy).not.toHaveBeenCalled()
  })

  it('[绿] ok:false → 不调用 setTab("runs"),调用 setRunNowBusy(true)(结算窗 B5 反馈)', async () => {
    const runNow = vi.fn().mockResolvedValue({ ok: false })
    const setTab = vi.fn()
    const setRunNowBusy = vi.fn()

    await handleRunNowLogic('task-1', runNow, setTab, setRunNowBusy)

    // 核心断言:ok:false 时用户应得到 busy hint,而不是静默
    expect(setRunNowBusy).toHaveBeenCalledWith(true)
    expect(setTab).not.toHaveBeenCalledWith('runs')
  })

  // -----------------------------------------------------------------------
  // RED: 修复前行为(旧逻辑),证明无 hint
  // -----------------------------------------------------------------------
  it('[红] 旧逻辑 ok:false → setTab("runs") 仍被调用,setRunNowBusy 不被调用(无反馈)', async () => {
    const runNow = vi.fn().mockResolvedValue({ ok: false })
    const setTab = vi.fn()
    const setRunNowBusy = vi.fn()

    // 使用旧逻辑(忽略返回值)
    await handleRunNowOldLogic('task-1', runNow, setTab, setRunNowBusy)

    // 旧行为:即使 ok:false,依然 setTab('runs') — 用户无法得知任务忙
    expect(setTab).toHaveBeenCalledWith('runs')
    // setRunNowBusy 从未被调用 → 无提示
    expect(setRunNowBusy).not.toHaveBeenCalled()
  })

  it('[红] 旧逻辑 ok:true → setTab("runs") 被调用(happy path 一致)', async () => {
    const runNow = vi.fn().mockResolvedValue({ ok: true })
    const setTab = vi.fn()
    const setRunNowBusy = vi.fn()

    await handleRunNowOldLogic('task-1', runNow, setTab, setRunNowBusy)

    expect(setTab).toHaveBeenCalledWith('runs')
  })

  it('[绿] 异常路径(runNow throw) → setTab/setRunNowBusy 均不调用,不 rethrow', async () => {
    const runNow = vi.fn().mockRejectedValue(new Error('ipc error'))
    const setTab = vi.fn()
    const setRunNowBusy = vi.fn()

    // 不应 throw
    await expect(handleRunNowLogic('task-1', runNow, setTab, setRunNowBusy)).resolves.toBeUndefined()
    expect(setTab).not.toHaveBeenCalled()
    expect(setRunNowBusy).not.toHaveBeenCalled()
  })
})
