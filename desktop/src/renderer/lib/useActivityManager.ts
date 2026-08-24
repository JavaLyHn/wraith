import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivitySnapshot } from '../../shared/types'

/**
 * 活动中心状态管理:加载、订阅推送、版本控制避免旧快照倒灌。
 *
 * 把 App.tsx L424-451 的 loadActivities + onActivityEvent 订阅逻辑集中到这里。
 */
export interface UseActivityManagerReturn {
  activitySnapshot: ActivitySnapshot
  loadActivities: (silent: boolean) => Promise<void>
  refreshVersion: () => void
}

export function useActivityManager(): UseActivityManagerReturn {
  const [activitySnapshot, setActivitySnapshot] = useState<ActivitySnapshot>({ activities: [], stale: false })
  const hasSnapshotRef = useRef(false)
  const versionRef = useRef(0)

  const loadActivities = useCallback(async (silent: boolean): Promise<void> => {
    const requestVersion = ++versionRef.current
    try {
      const next = await window.wraith.activityList()
      if (requestVersion !== versionRef.current) return
      hasSnapshotRef.current = true
      setActivitySnapshot(next)
    } catch (error) {
      if (requestVersion !== versionRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setActivitySnapshot(previous => hasSnapshotRef.current
        ? { ...previous, stale: true, error: message }
        : { activities: [], stale: false, error: message })
      if (!silent) console.error('[wraith] activityList error:', error)
    }
  }, [])

  // 订阅活动推送 + 初次拉取
  useEffect(() => {
    void loadActivities(false)
    return window.wraith.onActivityEvent(snapshot => {
      versionRef.current++
      hasSnapshotRef.current = true
      setActivitySnapshot(snapshot)
    })
  }, [loadActivities])

  return {
    activitySnapshot,
    loadActivities,
    refreshVersion: () => { versionRef.current++ },
  }
}
