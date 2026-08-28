import { useCallback } from 'react'
import { logger } from './logger'

import type { BackendEvent } from '../../shared/types'

export interface UseMessageOperationsOptions {
  getTurn: () => 'idle' | 'running'
  dispatch: (action: { type: string; [key: string]: unknown } | BackendEvent) => void
  fetchSessions: () => Promise<void>
  setSubmitError: (v: string | null) => void
}

export interface UseMessageOperationsReturn {
  rewindAndResubmit: (ordinal: number, text: string) => Promise<void>
  handleEditMessage: (ordinal: number, newText: string) => void
  handleResendMessage: (ordinal: number, text: string) => void
  handleDeleteMessage: (ordinal: number) => Promise<void>
}

export function useMessageOperations(
  opts: UseMessageOperationsOptions,
): UseMessageOperationsReturn {
  const { getTurn, dispatch, fetchSessions, setSubmitError } = opts

  const rewindAndResubmit = useCallback(
    async (ordinal: number, text: string) => {
      if (getTurn() === 'running') return
      setSubmitError(null)
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        dispatch({ type: 'addUserItem', text })
        void fetchSessions()
        dispatch({ type: 'markStarted' })
        await window.wraith.submitTurn(text)
      } catch (err) {
        logger.error('wraith', 'rewindAndResubmit error:', err)
        dispatch({ kind: 'notification', method: 'turn.failed', params: {} } as BackendEvent)
        const reason = err instanceof Error ? err.message : String(err)
        const short = reason.replace(/https?:\/\/\S+/g, '').replace(/sk-\S+/g, '').slice(0, 80).trim()
        setSubmitError(short ? `消息发送失败,请重试(${short})` : '消息发送失败,请重试')
      }
    },
    [getTurn, dispatch, fetchSessions, setSubmitError],
  )

  const handleEditMessage = useCallback(
    (ordinal: number, newText: string) => { void rewindAndResubmit(ordinal, newText) },
    [rewindAndResubmit],
  )

  const handleResendMessage = useCallback(
    (ordinal: number, text: string) => { void rewindAndResubmit(ordinal, text) },
    [rewindAndResubmit],
  )

  const handleDeleteMessage = useCallback(
    async (ordinal: number) => {
      if (getTurn() === 'running') return
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        void fetchSessions()
      } catch (err) {
        logger.error('wraith', 'deleteMessage error:', err)
      }
    },
    [getTurn, dispatch, fetchSessions],
  )

  return { rewindAndResubmit, handleEditMessage, handleResendMessage, handleDeleteMessage }
}