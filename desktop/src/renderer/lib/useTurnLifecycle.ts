import { useEffect, useRef } from 'react'
import type { RightPreview } from '../../shared/artifactSummary'

/**
 * turn 状态变化响应 hook:
 * 当 turn 从 running 变为 idle 时,刷新会话列表。
 * 同时暴露一个 prevTurnRef 供外部读取上一个 turn 状态。
 */
export function useTurnRefresh(
  turn: string,
  fetchSessions: () => void,
): void {
  const prevTurnRef = useRef(turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && turn === 'idle') {
      void fetchSessions()
    }
    prevTurnRef.current = turn
  }, [turn, fetchSessions])
}

/**
 * 折叠态下导航目标变化 → 自动收浮层。
 */
export function useSidebarPeekReset(params: {
  activeSessionId: string | null
  view: string
  sidebarCollapsed: boolean
  setSidebarPeek: (v: boolean) => void
}): void {
  const { activeSessionId, view, sidebarCollapsed, setSidebarPeek } = params
  useEffect(() => {
    if (sidebarCollapsed) setSidebarPeek(false)
  }, [activeSessionId, view, sidebarCollapsed, setSidebarPeek])
}

/**
 * 会话切换时清理 compact notice 和右侧预览。
 */
export function useSessionChangeCleanup(params: {
  sessionId: string
  clearCompactNotice: () => void
  setRightPreview: (p: RightPreview | null) => void
}): void {
  const { sessionId, clearCompactNotice, setRightPreview } = params
  useEffect(() => {
    clearCompactNotice()
    setRightPreview(null)
  }, [sessionId, clearCompactNotice, setRightPreview])
}
