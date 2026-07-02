import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createThrottleLatest } from '../src/shared/throttleLatest'

describe('createThrottleLatest', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('首个值立即 emit', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1)
    expect(got).toEqual([1])
  })
  it('窗口内只保留最新值,窗口结束时 emit 一次', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2); push(3)
    expect(got).toEqual([1])
    vi.advanceTimersByTime(100)
    expect(got).toEqual([1, 3])
  })
  it('连续窗口:flush 后的新值进入下一个窗口', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2)
    vi.advanceTimersByTime(100) // flush 2,同时开新窗
    push(3)                     // 落在新窗内 → 挂起
    expect(got).toEqual([1, 2])
    vi.advanceTimersByTime(100)
    expect(got).toEqual([1, 2, 3])
  })
  it('窗口结束且无挂起值 → 不额外 emit,下个值又是立即 emit', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1)
    vi.advanceTimersByTime(100)
    push(2)
    expect(got).toEqual([1, 2])
  })
  it('cancel 清掉挂起值与定时器,不再 emit', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2)
    push.cancel()
    vi.advanceTimersByTime(300)
    expect(got).toEqual([1])
  })
  it('cancel 后下一次 push 回到立即 emit 路径', () => {
    const got: number[] = []
    const push = createThrottleLatest<number>(100, v => got.push(v))
    push(1); push(2)
    push.cancel()
    push(3)
    expect(got).toEqual([1, 3])
  })
})
