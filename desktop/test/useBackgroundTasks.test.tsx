// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { useBackgroundTasks } from '../src/renderer/lib/useBackgroundTasks'
import type { DurableTaskView } from '../src/shared/types'

afterEach(cleanup)

function task(id: string, status: string): DurableTaskView {
  return { id, status, prompt: 'p-' + id, createdAtMs: 0, durationMs: 1000 }
}

/** 轮询间隔压到 10ms —— 否则每条用例都要真等 15s,单文件就把整套从 10s 拖到 54s。 */
const FAST = (): number => 10

function Probe({ list, onFinished }: {
  list: (n: number) => Promise<{ tasks?: DurableTaskView[]; enabled?: boolean }>
  onFinished: (t: DurableTaskView[]) => void
}): JSX.Element {
  const n = useBackgroundTasks(list, onFinished, FAST)
  return <span data-testid="n">{n}</span>
}

/**
 * 真机验证时踩出来的坑:应用刚起来、后端还没就绪时,taskList 会失败或返回空。
 * 若把"失败"当成"目前没有任务",播种就会以空集合完成 —— 下一次成功拉取时,
 * 磁盘上所有历史完成项都成了"新完成的",一次性灌满对话。
 */
describe('useBackgroundTasks', () => {
  it('首次拉取失败不播种;等成功那次再播种,且不误报历史任务', async () => {
    const onFinished = vi.fn()
    let call = 0
    const list = vi.fn(async () => {
      call++
      if (call === 1) throw new Error('backend not ready')
      return { tasks: [task('a', 'completed'), task('b', 'completed')] }
    })

    render(<Probe list={list} onFinished={onFinished} />)

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 })
    // 第二次(成功)那次才是播种 —— 历史完成项一条都不该播
    await new Promise((r) => setTimeout(r, 50))
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('enabled:false(会话未建立)与失败同等对待,同样不播种', async () => {
    // main 把后端的 "no session" 翻译成 enabled:false 以免每次轮询刷一屏错误栈;
    // 但它**不能**被当成空列表 —— 那等于用空集合完成播种,下次成功拉取会误报全部历史任务。
    const onFinished = vi.fn()
    let call = 0
    const list = vi.fn(async () => {
      call++
      if (call === 1) return { enabled: false, tasks: [] }
      return { enabled: true, tasks: [task('a', 'completed'), task('b', 'completed')] }
    })

    render(<Probe list={list} onFinished={onFinished} />)

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 })
    await new Promise((r) => setTimeout(r, 50))
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('播种之后新完成的任务才回调', async () => {
    const onFinished = vi.fn()
    let call = 0
    const list = vi.fn(async () => {
      call++
      if (call === 1) return { tasks: [task('old', 'completed')] }
      return { tasks: [task('old', 'completed'), task('fresh', 'completed')] }
    })

    render(<Probe list={list} onFinished={onFinished} />)

    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 2_000 })
    const reported = onFinished.mock.calls[0]![0] as DurableTaskView[]
    expect(reported.map((t) => t.id)).toEqual(['fresh'])
  })
})
