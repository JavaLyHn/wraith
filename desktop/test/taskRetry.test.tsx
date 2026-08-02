// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import TaskPanel from '../src/renderer/components/TaskPanel'
import { taskCanRetry } from '../src/renderer/lib/taskView'

/**
 * 「重试」入口。
 *
 * 起因：一个 bug 让后台任务全部失败（app-server 把启动时的 null client 永久捕获了）。
 * 修好之后用户发现——**已经失败的记录不会自愈**，而面板上只有「取消」，
 * 想重跑只能把 prompt 手打一遍。
 *
 * 语义：重试 = 用同样的 prompt **新建一条**，原失败记录保留（失败发生过，别抹掉）。
 */

const failed = { id: 't1', status: 'failed', prompt: '把 utils 重构并补测试', durationMs: 5, error: 'boom' }
const canceled = { id: 't2', status: 'canceled', prompt: '你好', durationMs: 17 }
const completed = { id: 't3', status: 'completed', prompt: '已经好了', durationMs: 900, result: 'ok' }
const running = { id: 't4', status: 'running', prompt: '跑着呢', durationMs: 0 }

function stub(tasks: unknown[], taskAdd = vi.fn().mockResolvedValue({ ok: true })) {
  const taskList = vi.fn().mockResolvedValue({ enabled: true, tasks })
  ;(window as unknown as { wraith: unknown }).wraith = {
    taskList, taskAdd, taskCancel: vi.fn().mockResolvedValue({}), taskGet: vi.fn(),
  }
  return { taskList, taskAdd }
}

describe('taskCanRetry（纯判据）', () => {
  it('只给没拿到结果的两种状态', () => {
    expect(taskCanRetry('failed')).toBe(true)
    expect(taskCanRetry('canceled')).toBe(true)
  })

  it('已完成不给 —— 那是「再跑一遍」不是「重试」,且后台任务会改文件,误点代价不小', () => {
    expect(taskCanRetry('completed')).toBe(false)
  })

  it('未终态不给 —— 那时候该显示的是「取消」', () => {
    expect(taskCanRetry('running')).toBe(false)
    expect(taskCanRetry('enqueued')).toBe(false)
  })
})

describe('TaskPanel 重试按钮', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('失败的任务出现重试入口', async () => {
    stub([failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.getByTestId('task-retry')).toBeTruthy()
  })

  it('已取消的也能重试', async () => {
    stub([canceled])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.getByTestId('task-retry')).toBeTruthy()
  })

  it('已完成 / 运行中都不出现重试', async () => {
    stub([completed, running])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.queryByTestId('task-retry')).toBeNull()
  })

  it('重试与取消互斥 —— 运行中只有取消,失败只有重试', async () => {
    stub([running])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.getByTestId('task-cancel')).toBeTruthy()
    expect(screen.queryByTestId('task-retry')).toBeNull()

    cleanup()
    stub([failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.getByTestId('task-retry')).toBeTruthy()
    expect(screen.queryByTestId('task-cancel')).toBeNull()
  })

  it('点击后用**原 prompt**重新提交,并刷新列表', async () => {
    const { taskList, taskAdd } = stub([failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    const before = taskList.mock.calls.length

    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(taskAdd).toHaveBeenCalledWith('把 utils 重构并补测试')
    expect(taskList.mock.calls.length).toBeGreaterThan(before)   // 提交后要刷新,否则看不到新任务
  })

  it('重试走的是 taskAdd（新建一条），不是某个「复活」接口 —— 原记录必须留着', async () => {
    const { taskAdd } = stub([failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(taskAdd).toHaveBeenCalledTimes(1)
    // 没有任何「删掉/改写原任务」的调用：失败发生过,审计上不该被抹掉
    const w = (window as unknown as { wraith: Record<string, unknown> }).wraith
    expect(w.taskCancel).not.toHaveBeenCalled()
  })

  it('后端拒绝时把原因显示出来,而不是静默什么都没发生', async () => {
    stub([failed], vi.fn().mockResolvedValue({ ok: false, message: '后台任务不可用' }))
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(screen.getByText(/后台任务不可用/)).toBeTruthy()
  })
})
