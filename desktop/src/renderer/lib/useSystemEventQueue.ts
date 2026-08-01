import { useCallback, useEffect, useRef } from 'react'

/**
 * 系统事件补轮排队。
 *
 * 为什么需要:app-server 单会话同时只允许一个 turn,轮次在跑时再 turn.submit 会直接
 * 回 "turn in progress" 报错(用户会看到莫名其妙的错误横幅)。而绑定完成的时机完全
 * 由用户扫码决定,撞上正在跑的轮次是常态而非例外。
 *
 * 语义:空闲即发;忙则入队,等轮次落回空闲再按入队顺序补发。已发出的绝不重放
 * —— 轮次 running↔idle 会反复切换,重放会让同一条事件被讲很多遍。
 */
export function useSystemEventQueue(
  turnRunning: boolean,
  emit: (text: string) => void,
): (text: string) => void {
  const queue = useRef<string[]>([])
  // emit 通常是每次渲染新建的闭包;存 ref 里避免把它列进 effect 依赖导致反复重跑。
  const emitRef = useRef(emit)
  useEffect(() => { emitRef.current = emit }, [emit])

  const flush = useCallback(() => {
    const pending = queue.current
    queue.current = []
    for (const text of pending) emitRef.current(text)
  }, [])

  const enqueue = useCallback((text: string) => {
    queue.current.push(text)
    if (!turnRunning) flush()
  }, [turnRunning, flush])

  useEffect(() => {
    if (!turnRunning && queue.current.length > 0) flush()
  }, [turnRunning, flush])

  return enqueue
}
