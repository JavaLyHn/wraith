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
 * <b>语义(用户明确改过一次)</b>：重试 = 用同样的 prompt 新建一条，
 * <b>并把原来那条删掉</b>，列表里只留最新的。
 *
 * 落地时我按「失败发生过，审计上不该抹掉」保留了原记录，用户看完直接否了：
 * 「点击重试以后之前的就不要了，就保留重试的最新的」。他是对的——
 * 这是任务队列面板不是审计日志（真审计在 `~/.wraith/audit/`），
 * 反复重试三次就有三条僵尸失败记录压在上面，把在跑的那条挤没了。
 *
 * <b>顺序是 add 再 delete，不能反</b>：先删的话，一旦 add 失败，
 * 用户的 prompt 就随着那条记录一起没了，连重打一遍的依据都不剩。
 */

const failed = { id: 't1', status: 'failed', prompt: '把 utils 重构并补测试', durationMs: 5, error: 'boom' }
const canceled = { id: 't2', status: 'canceled', prompt: '你好', durationMs: 17 }
const completed = { id: 't3', status: 'completed', prompt: '已经好了', durationMs: 900, result: 'ok' }
const running = { id: 't4', status: 'running', prompt: '跑着呢', durationMs: 0 }

function stub(tasks: unknown[], taskAdd = vi.fn().mockResolvedValue({ ok: true })) {
  const taskList = vi.fn().mockResolvedValue({ enabled: true, tasks })
  const taskDelete = vi.fn().mockResolvedValue({ ok: true })
  ;(window as unknown as { wraith: unknown }).wraith = {
    taskList, taskAdd, taskDelete, taskCancel: vi.fn().mockResolvedValue({}), taskGet: vi.fn(),
  }
  return { taskList, taskAdd, taskDelete }
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

  it('重试走的是 taskAdd（新建一条）+ taskDelete（顶替原记录）', async () => {
    const { taskAdd, taskDelete } = stub([failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(taskAdd).toHaveBeenCalledTimes(1)
    expect(taskDelete).toHaveBeenCalledWith('t1')   // 「之前的就不要了」
    // 不走 cancel:原记录已经是终态,cancel 对它是 no-op,用它来"删"是名不副实
    const w = (window as unknown as { wraith: Record<string, unknown> }).wraith
    expect(w.taskCancel).not.toHaveBeenCalled()
  })

  it('add 失败时**不删**原记录 —— 否则 prompt 跟着一起没了', async () => {
    const { taskDelete } = stub([failed], vi.fn().mockResolvedValue({ ok: false, message: '队列满了' }))
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(taskDelete).not.toHaveBeenCalled()
    expect(screen.getByText(/队列满了/)).toBeTruthy()
  })

  it('add 成功但 delete 失败:新任务已经在跑,如实说一声,不谎报重试失败', async () => {
    const { taskAdd } = stub([failed])
    const w = (window as unknown as { wraith: Record<string, unknown> }).wraith
    w.taskDelete = vi.fn().mockResolvedValue({ ok: false, message: '任务不存在(可能已被删除)' })

    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(taskAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/可能已被删除/)).toBeTruthy()
  })

  it('后端拒绝时把原因显示出来,而不是静默什么都没发生', async () => {
    stub([failed], vi.fn().mockResolvedValue({ ok: false, message: '后台任务不可用' }))
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    await act(async () => { fireEvent.click(screen.getByTestId('task-retry')) })

    expect(screen.getByText(/后台任务不可用/)).toBeTruthy()
  })
})
