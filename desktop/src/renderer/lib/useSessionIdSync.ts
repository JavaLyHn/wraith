import { useEffect } from 'react'

/**
 * sessionId 同步与清理 hook:
 * 1. 让 sessionIdRef.current 随 sessionId 变化同步(供 useSessionFailureTracking 使用)
 * 2. 切会话时清除当前会话的感叹号标记(会话已切换,不再显示旧故障)
 */
export function useSessionIdSync(params: {
  sessionId: string
  sessionIdRef: React.MutableRefObject<string>
  setFailedSessions: React.Dispatch<React.SetStateAction<Set<string>>>
}): void {
  const { sessionId, sessionIdRef, setFailedSessions } = params

  // 让 sessionIdRef 随 state.sessionId 同步
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId, sessionIdRef])

  // 切会话时清除感叹号
  useEffect(() => {
    setFailedSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, setFailedSessions])
}
