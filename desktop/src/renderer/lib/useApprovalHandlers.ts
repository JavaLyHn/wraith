import { useCallback } from 'react'
import { logger } from './logger'
import type { ApprovalResponsePayload } from '../../shared/buildApprovalResponse'

export interface UseApprovalHandlersOptions {
  dispatch: (action: { type: string; [key: string]: unknown }) => void
  getPendingApproval: () => { approvalId: string } | null
}

export interface UseApprovalHandlersReturn {
  handleApprovalRespond: (payload: ApprovalResponsePayload) => Promise<void>
  handleApprovalCancel: () => Promise<void>
  handlePlanReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
  handleToggleApproval: (auto: boolean) => Promise<void>
}

export function useApprovalHandlers(
  opts: UseApprovalHandlersOptions,
): UseApprovalHandlersReturn {
  const { dispatch, getPendingApproval } = opts

  const handleApprovalRespond = useCallback(
    async (payload: ApprovalResponsePayload) => {
      const pending = getPendingApproval()
      if (!pending) return
      try {
        await window.wraith.respondApproval(pending.approvalId, payload.decision, {
          ...(payload.modifiedArgs ? { modifiedArgs: payload.modifiedArgs } : {}),
          ...(payload.allowNetwork ? { allowNetwork: true } : {}),
        })
      } finally {
        dispatch({ type: 'clearApproval' })
      }
    },
    [getPendingApproval, dispatch],
  )

  const handleApprovalCancel = useCallback(
    async () => {
      const pending = getPendingApproval()
      if (!pending) return
      try {
        await window.wraith.respondApproval(pending.approvalId, 'REJECTED')
      } finally {
        dispatch({ type: 'clearApproval' })
      }
    },
    [getPendingApproval, dispatch],
  )

  const handlePlanReview = useCallback(
    (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => {
      void window.wraith.respondPlanReview(reviewId, decision, feedback)
      dispatch({ type: 'markPlanReviewResolved', reviewId })
    },
    [dispatch],
  )

  const handleToggleApproval = useCallback(
    async (auto: boolean) => {
      const mode = auto ? 'auto' : 'ask'
      dispatch({ type: 'setApprovalMode', mode })
      try {
        await window.wraith.setApprovalMode(auto)
      } catch (err) {
        logger.error('wraith', 'setApprovalMode error:', err)
        dispatch({ type: 'setApprovalMode', mode: auto ? 'ask' : 'auto' })
      }
    },
    [dispatch],
  )

  return { handleApprovalRespond, handleApprovalCancel, handlePlanReview, handleToggleApproval }
}