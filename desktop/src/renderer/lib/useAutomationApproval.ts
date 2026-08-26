import { useCallback, useRef, useState } from 'react'

export interface AutomationApprovalPayload {
  runId: string
  payload: Record<string, unknown>
}

export interface UseAutomationApprovalReturn {
  automationApproval: AutomationApprovalPayload | null
  setAutomationApproval: React.Dispatch<React.SetStateAction<AutomationApprovalPayload | null>>
  automationApprovalRef: React.MutableRefObject<AutomationApprovalPayload | null>
  handleAutomationApprovalRespond: (payload: unknown) => Promise<void>
  handleAutomationApprovalReject: () => Promise<void>
}

export function useAutomationApproval(): UseAutomationApprovalReturn {
  const [automationApproval, setAutomationApproval] = useState<AutomationApprovalPayload | null>(null)
  const automationApprovalRef = useRef<AutomationApprovalPayload | null>(null)

  const handleAutomationApprovalRespond = useCallback(async (_payload: unknown) => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    automationApprovalRef.current = null
    try {
      await window.wraith.automationRespondApproval(String(cur.payload['approvalId']), 'approve')
    } catch (err) {
      console.error('[wraith] automation respond error:', err)
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
      console.error('[wraith] automation reject error:', err)
    }
  }, [automationApproval])

  return {
    automationApproval,
    setAutomationApproval,
    automationApprovalRef,
    handleAutomationApprovalRespond,
    handleAutomationApprovalReject,
  }
}