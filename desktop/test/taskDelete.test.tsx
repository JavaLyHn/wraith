// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import TaskPanel from '../src/renderer/components/TaskPanel'
import { taskCanDelete } from '../src/renderer/lib/taskView'

/**
 * 后台任务的删除。
 *
 * <p>面板此前只能「取消」——终态记录一旦躺进列表就再也拿不掉，跑了几十个之后
 * 在跑的那条会被历史淹掉。用户直接要求：「后台任务新增删除功能」。
 *
 * <p><b>只给终态</b>：运行中的任务 worker 线程还活着，删了行它照样在改文件，
 * 而面板上它已经消失了。后端会硬拒（见 DurableTaskDeleteTest），
 * 前端不显示这个按钮，是同一条规则的两层落实 —— 不是重复，
 * 后端那层防的是别的调用方（终端 /task、以后的 IM 网关）。
 */

const failed = { id: 't1', status: 'failed', prompt: '把 utils 重构并补测试', durationMs: 5, error: 'boom' }
const completed = { id: 't2', status: 'completed', prompt: '已经好了', durationMs: 900, result: 'ok' }
const canceled = { id: 't3', status: 'canceled', prompt: '算了', durationMs: 17 }
const running = { id: 't4', status: 'running', prompt: '跑着呢', durationMs: 0 }
const enqueued = { id: 't5', status: 'enqueued', prompt: '排着呢', durationMs: 0 }

function stub(tasks: unknown[], taskDelete = vi.fn().mockResolvedValue({ ok: true })) {
  const taskList = vi.fn().mockResolvedValue({ enabled: true, tasks })
  ;(window as unknown as { wraith: unknown }).wraith = {
    taskList, taskDelete,
    taskAdd: vi.fn().mockResolvedValue({ ok: true, id: 'new' }),
    taskCancel: vi.fn().mockResolvedValue({ ok: true }),
    taskGet: vi.fn(),
  }
  return { taskList, taskDelete }
}

describe('taskCanDelete（纯判据）', () => {
  it('终态可删', () => {
    expect(taskCanDelete('completed')).toBe(true)
    expect(taskCanDelete('failed')).toBe(true)
    expect(taskCanDelete('canceled')).toBe(true)
  })

  it('未终态不可删 —— worker 还握着它,删了行它照样在改文件', () => {
    expect(taskCanDelete('running')).toBe(false)
    expect(taskCanDelete('enqueued')).toBe(false)
  })

  it('认不出的状态一律不给删(保守)', () => {
    expect(taskCanDelete('')).toBe(false)
    expect(taskCanDelete('weird')).toBe(false)
  })
})

describe('TaskPanel 删除按钮', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('已完成 / 失败 / 已取消都给删除入口', async () => {
    for (const t of [completed, failed, canceled]) {
      stub([t])
      await act(async () => { render(<TaskPanel onBack={() => {}} />) })
      expect(screen.getByTestId('task-delete'), `${t.status} 应可删`).toBeTruthy()
      cleanup()
    }
  })

  it('运行中 / 排队中没有删除入口,只有取消', async () => {
    for (const t of [running, enqueued]) {
      stub([t])
      await act(async () => { render(<TaskPanel onBack={() => {}} />) })
      expect(screen.queryByTestId('task-delete'), `${t.status} 不该可删`).toBeNull()
      expect(screen.getByTestId('task-cancel')).toBeTruthy()
      cleanup()
    }
  })

  it('点击后按 id 删,并刷新列表', async () => {
    const { taskList, taskDelete } = stub([completed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    const before = taskList.mock.calls.length

    await act(async () => { fireEvent.click(screen.getByTestId('task-delete')) })

    expect(taskDelete).toHaveBeenCalledWith('t2')
    expect(taskList.mock.calls.length).toBeGreaterThan(before)
  })

  it('后端拒绝时把原因显示出来 —— 「删除失败」四个字等于没说', async () => {
    stub([completed], vi.fn().mockResolvedValue({ ok: false, message: '任务还在运行,请先取消再删除' }))
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })

    await act(async () => { fireEvent.click(screen.getByTestId('task-delete')) })

    expect(screen.getByText(/请先取消再删除/)).toBeTruthy()
  })

  it('IPC 抛异常也要落到界面上,不能静默', async () => {
    stub([completed], vi.fn().mockRejectedValue(new Error('Backend not connected')))
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })

    await act(async () => { fireEvent.click(screen.getByTestId('task-delete')) })

    expect(screen.getByText(/Backend not connected/)).toBeTruthy()
  })

  it('多条记录时只删被点的那条', async () => {
    const { taskDelete } = stub([completed, failed])
    await act(async () => { render(<TaskPanel onBack={() => {}} />) })

    const buttons = screen.getAllByTestId('task-delete')
    expect(buttons).toHaveLength(2)
    await act(async () => { fireEvent.click(buttons[1]) })

    expect(taskDelete).toHaveBeenCalledTimes(1)
    expect(taskDelete).toHaveBeenCalledWith('t1')
  })
})
