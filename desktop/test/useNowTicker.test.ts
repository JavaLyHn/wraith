// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useNowTicker } from '../src/renderer/lib/useNowTicker'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useNowTicker', () => {
  it('到点吐出新的时刻', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 1, 16, 0, 0))
    const { result } = renderHook(() => useNowTicker(30_000))
    const first = result.current

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(first + 30_000)

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe(first + 90_000)
  })

  it('未到点不变(不做无谓重渲染)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNowTicker(30_000))
    const first = result.current
    act(() => { vi.advanceTimersByTime(29_000) })
    expect(result.current).toBe(first)
  })

  it('卸载后停止,不留悬空定时器', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useNowTicker(30_000))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('间隔非正数时不起定时器(脏参数兜底)', () => {
    vi.useFakeTimers()
    renderHook(() => useNowTicker(0))
    expect(vi.getTimerCount()).toBe(0)
  })
})
