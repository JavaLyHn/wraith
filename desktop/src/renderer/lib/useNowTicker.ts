import { useEffect, useState } from 'react'

/**
 * 每 intervalMs 吐出一个新的 Date.now(),让依赖「当前时刻」的标签自己走字。
 *
 * 为什么需要:computeNextRunLabel 这类标签在渲染时采样一次时间,组件不重渲染就永远
 * 停在那一刻。自动化面板只在收到 runs-changed 事件时刷新,而任务从没触发过时(守护
 * 进程没起)根本没有事件 —— 于是「下次」就冻住了。
 *
 * 30s 级别的跳动对分钟粒度的展示足够,且不会造成可感的重渲染开销。
 */
export function useNowTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!(intervalMs > 0)) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
