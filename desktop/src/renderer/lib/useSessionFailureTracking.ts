import { useEffect, useRef, useState } from 'react'
import type { BackendEvent } from '../../shared/types'

/**
 * 会话异常中断标记:跟踪 LLM 失败 / 后端断开的会话 id 集合。
 * 侧栏会话行右侧显示感叹号。不落盘,重启后自动清空。
 *
 * 把 App.tsx L202-204 + L487-531 的相关逻辑集中到这里。
 */
export interface UseSessionFailureTrackingReturn {
  failedSessions: Set<string>
  setFailedSessions: React.Dispatch<React.SetStateAction<Set<string>>>
  sessionIdRef: React.MutableRefObject<string>
  markFailedForCurrent: () => void
  clearFailedFor: (id: string) => void
}

export function useSessionFailureTracking(): UseSessionFailureTrackingReturn {
  const [failedSessions, setFailedSessions] = useState<Set<string>>(() => new Set())
  const sessionIdRef = useRef('')

  // 标记当前会话为异常
  const markFailedForCurrent = () => {
    const id = sessionIdRef.current
    if (!id) return
    setFailedSessions(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  // 清除指定会话的异常标记
  const clearFailedFor = (id: string) => {
    if (!id) return
    setFailedSessions(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // 订阅 turn.failed / turn.completed(error) / 后端断开
  useEffect(() => {
    return window.wraith.onEvent((evt: BackendEvent) => {
      if (evt.kind !== 'notification') {
        if (evt.kind === 'connection' && evt.state === 'disconnected') {
          const id = sessionIdRef.current
          if (id) setFailedSessions(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
        }
        return
      }
      if (evt.method === 'turn.failed') {
        const id = sessionIdRef.current
        if (id) setFailedSessions(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
        return
      }
      if (evt.method === 'turn.completed') {
        const p = evt.params as { sessionId?: string; error?: string } | null
        const id = (typeof p?.sessionId === 'string' && p.sessionId) ? p.sessionId : sessionIdRef.current
        if (!id) return
        const hasError = typeof p?.error === 'string' && p.error.length > 0
        setFailedSessions(prev => {
          const marked = prev.has(id)
          if (hasError && !marked) return new Set(prev).add(id)
          if (!hasError && marked) { const next = new Set(prev); next.delete(id); return next }
          return prev
        })
      }
    })
  }, [])

  return { failedSessions, setFailedSessions, sessionIdRef, markFailedForCurrent, clearFailedFor }
}
