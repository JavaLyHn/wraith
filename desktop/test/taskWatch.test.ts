import { describe, it, expect } from 'vitest'
import { activeCount, initialWatchState, pollIntervalMs, stepWatch, taskDoneLabel } from '../src/shared/taskWatch'
import type { DurableTaskView } from '../src/shared/types'

function task(id: string, status: string, over: Partial<DurableTaskView> = {}): DurableTaskView {
  return { id, status, prompt: 'p-' + id, createdAtMs: 0, durationMs: 0, ...over }
}

/**
 * 后台任务在对话里的告知靠前端轮询 taskList 比对(后端不推送任何任务事件)。
 * 这套比对最容易出的两个错都在这里钉住:开机刷屏、以及漏掉跑得太快的任务。
 */
describe('后台任务轮询比对', () => {
  it('首轮静默:开机时躺着的历史完成项一条都不播', () => {
    // 不播种的话,应用一起来就会往对话里灌十几条「后台任务完成」,而那些可能是几天前跑的
    const s = stepWatch(initialWatchState(), [
      task('a', 'completed'), task('b', 'failed'), task('c', 'running'),
    ])
    expect(s.finished).toEqual([])
    expect(s.active).toBe(1)
    expect(s.next.seeded).toBe(true)
  })

  it('首轮之后,新完成的才播', () => {
    let st = stepWatch(initialWatchState(), [task('a', 'completed'), task('b', 'running')]).next
    const s = stepWatch(st, [task('a', 'completed'), task('b', 'completed')])
    expect(s.finished.map(t => t.id)).toEqual(['b'])
    expect(s.active).toBe(0)
  })

  it('同一个任务只播一次', () => {
    let st = stepWatch(initialWatchState(), [task('b', 'running')]).next
    st = stepWatch(st, [task('b', 'completed')]).next
    expect(stepWatch(st, [task('b', 'completed')]).finished).toEqual([])
  })

  it('跑得太快、从没在活跃态被观测到的任务也要播', () => {
    // 轮询间隔 3s,一个 2s 就跑完的任务可能两次轮询之间生灭 —— 若判据是"看着它从 running 变终态"就会漏
    const st = stepWatch(initialWatchState(), [task('old', 'completed')]).next
    const s = stepWatch(st, [task('old', 'completed'), task('fast', 'completed')])
    expect(s.finished.map(t => t.id)).toEqual(['fast'])
  })

  it('失败与取消也播,但文案不一样', () => {
    expect(taskDoneLabel(task('x', 'completed', { prompt: '统计 java 文件数', durationMs: 11_000 })))
      .toBe('后台任务完成:统计 java 文件数 · 11s')
    expect(taskDoneLabel(task('x', 'failed', { prompt: '炸了', durationMs: 2_000 })))
      .toContain('失败')
    expect(taskDoneLabel(task('x', 'canceled', { prompt: '算了' })))
      .toContain('已取消')
  })

  it('长 prompt 截断,换行压成一行', () => {
    const label = taskDoneLabel(task('x', 'completed', { prompt: '第一行\n第二行'.repeat(20) }))
    expect(label).not.toContain('\n')
    expect(label.length).toBeLessThan(60)
  })

  it('活跃数 = running + enqueued', () => {
    expect(activeCount([
      task('a', 'running'), task('b', 'enqueued'), task('c', 'completed'),
      task('d', 'failed'), task('e', 'canceled'),
    ])).toBe(2)
  })

  it('有任务在跑时轮询更勤,闲着时放慢', () => {
    expect(pollIntervalMs(2)).toBeLessThan(pollIntervalMs(0))
    expect(pollIntervalMs(0)).toBeGreaterThanOrEqual(10_000)
  })
})
