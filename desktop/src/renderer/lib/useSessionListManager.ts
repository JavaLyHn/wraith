import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../shared/types'

/**
 * 会话列表管理:获取、手动排序持久化、拖拽重排。
 *
 * 把 App.tsx L533-599 的 fetchSessions + applyManualOrder + handleReorderSession
 * 集中到这里。
 */
export interface UseSessionListManagerReturn {
  sessions: SessionMeta[]
  setSessions: React.Dispatch<React.SetStateAction<SessionMeta[]>>
  fetchSessions: () => Promise<void>
  handleReorderSession: (sourceId: string, targetId: string, targetSection?: 'starred' | 'rest') => void
}

export function useSessionListManager(
  onStarChange: (id: string, starred: boolean) => Promise<void>,
): UseSessionListManagerReturn {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const manualOrderRef = useRef<string[]>([])

  // 初始化时加载手动排序
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wraith.sidebar.sessionOrder')
      if (raw) manualOrderRef.current = JSON.parse(raw) as string[]
    } catch { /* ignore */ }
  }, [])

  const applyManualOrder = useCallback((list: SessionMeta[]): SessionMeta[] => {
    const order = manualOrderRef.current
    if (order.length === 0) return list
    const orderMap = new Map<string, number>()
    order.forEach((id, i) => orderMap.set(id, i))
    const ordered: SessionMeta[] = []
    const unordered: SessionMeta[] = []
    for (const s of list) {
      if (orderMap.has(s.id)) ordered.push(s)
      else unordered.push(s)
    }
    ordered.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
    unordered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return [...ordered, ...unordered]
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const { sessions } = await window.wraith.listSessions()
      setSessions(applyManualOrder(sessions))
    } catch (err) {
      console.error('[wraith] listSessions error:', err)
    }
  }, [applyManualOrder])

  const handleReorderSession = useCallback((sourceId: string, targetId: string, targetSection?: 'starred' | 'rest') => {
    const wantStar = targetSection === 'starred'
    setSessions(prev => {
      const ids = prev.map(s => s.id)
      const sourceIdx = ids.indexOf(sourceId)
      const targetIdx = ids.indexOf(targetId)
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return prev
      const next = [...prev]
      const [moved] = next.splice(sourceIdx, 1)
      const crossSection = targetSection != null && moved.starred !== wantStar
      next.splice(targetIdx, 0, crossSection ? { ...moved, starred: wantStar } : moved)
      const newOrder = next.map(s => s.id)
      manualOrderRef.current = newOrder
      try { localStorage.setItem('wraith.sidebar.sessionOrder', JSON.stringify(newOrder)) } catch { /* ignore */ }
      return next
    })
    if (targetSection != null) {
      void onStarChange(sourceId, wantStar)
    }
  }, [onStarChange])

  return { sessions, setSessions, fetchSessions, handleReorderSession }
}
