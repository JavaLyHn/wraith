import { useCallback, useRef, useState } from 'react'
import { logger } from './logger'
import type { ActivityItem } from '../../shared/types'

export interface CachedApproval {
  runId: string
  payload: Record<string, unknown>
}

export interface UseActivityHandlersOptions {
  setView: (v: string) => void
  loadActivities: (silent: boolean) => Promise<void>
}

export interface UseActivityHandlersReturn {
  automationApproval: CachedApproval | null
  setAutomationApproval: React.Dispatch<React.SetStateAction<CachedApproval | null>>
  automationApprovalRef: React.MutableRefObject<CachedApproval | null>
  handleAutomationApprovalRespond: (payload: unknown) => Promise<void>
  handleAutomationApprovalReject: () => Promise<void>
  handleOpenActivityTask: (item: ActivityItem) => void
  handleOpenActivityAutomation: (item: ActivityItem) => void
  handleCancelActivity: (item: ActivityItem) => Promise<{ ok: boolean; message?: string }>
  handleReopenApproval: (runId: string) => Promise<void>
}

export function useActivityHandlers(opts: UseActivityHandlersOptions): UseActivityHandlersReturn {
  const [automationApproval, setAutomationApproval] = useState<CachedApproval | null>(null)
  const automationApprovalRef = useRef<CachedApproval | null>(null)

  const handleAutomationApprovalRespond = useCallback(async (_payload: unknown) => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    automationApprovalRef.current = null
    try {
      await window.wraith.automationRespondApproval(String(cur.payload['approvalId']), 'approve')
    } catch (err) {
      logger.error('wraith', 'automation respond error:', err)
    }
  }, [automationApproval])

  const handleAutomationApprovalReject = useCallback(async () => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    automationApprovalRef.current = null
    try {
      await window.wraith.automationRespondApproval(String(cur.payload['approvalId']), 'reject')
    } catch (err) {
      logger.error('wraith', 'automation reject error:', err)
    }
  }, [automationApproval])

  const handleOpenActivityTask = useCallback((_item: ActivityItem) => {
    opts.setView('tasks')
  }, [opts])

  const handleOpenActivityAutomation = useCallback((item: ActivityItem) => {
    void item
    opts.setView('automations')
  }, [opts])

  const handleCancelActivity = useCallback(async (item: ActivityItem) => {
    const id = item.kind === 'session' ? item.sessionId : item.kind === 'task' ? item.taskId : item.runId
    if (!id) return { ok: false, message: '活动缺少可取消的来源标识' }
    const result = await window.wraith.activityCancel({ kind: item.kind, id })
    if (result.ok) void opts.loadActivities(true)
    return result
  }, [opts])

  const handleReopenApproval = useCallback(async (runId: string) => {
    const cached = automationApprovalRef.current
    if (!cached || cached.runId !== runId) return
    try {
      const { runs } = await window.wraith.automationRuns()
      const run = runs.find(r => r.runId === runId)
      if (run?.status === 'waiting_approval') {
        setAutomationApproval(cached)
      } else {
        automationApprovalRef.current = null
      }
    } catch (err) {
      logger.error('wraith', 'handleReopenApproval error:', err)
    }
  }, [])

  return {
    automationApproval,
    setAutomationApproval,
    automationApprovalRef,
    handleAutomationApprovalRespond,
    handleAutomationApprovalReject,
    handleOpenActivityTask,
    handleOpenActivityAutomation,
    handleCancelActivity,
    handleReopenApproval,
  }
}