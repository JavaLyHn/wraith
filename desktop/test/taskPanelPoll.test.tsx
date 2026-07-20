// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import TaskPanel from '../src/renderer/components/TaskPanel'

const running = { id: 't1', status: 'running', prompt: '你好', durationMs: 0 }
const done = { id: 't1', status: 'completed', prompt: '你好', durationMs: 2591, result: '你好!' }

describe('TaskPanel 自动轮询', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

  it('有运行中任务→自动轮询→完成后更新为已完成,全终态后停止轮询', async () => {
    const taskList = vi.fn()
      .mockResolvedValueOnce({ enabled: true, tasks: [running] })
      .mockResolvedValue({ enabled: true, tasks: [done] })
    ;(window as unknown as { wraith: { taskList: typeof taskList } }).wraith = { taskList }

    await act(async () => { render(<TaskPanel onBack={() => {}} />) })
    expect(screen.getByText('运行中')).toBeTruthy()          // 初次:运行中
    const firstCalls = taskList.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })  // 轮询一次 → 完成
    expect(screen.queryByText('运行中')).toBeNull()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(taskList.mock.calls.length).toBeGreaterThan(firstCalls)      // 确实轮询过

    const afterDone = taskList.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })  // 全终态后不再轮询
    expect(taskList.mock.calls.length).toBe(afterDone)
  })
})
