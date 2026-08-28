import { useCallback } from 'react'
import { logger } from './logger'
import { shouldBlockImageSend } from '../../shared/modelVision'
import { pendingModeAfterSubmit } from './nextPendingMode'
import type { RunMode } from '../../shared/types'
import type { AttachmentItem } from '../components/Composer'

export interface UseChatSubmissionOptions {
  getInputValue: () => string
  getAttachments: () => AttachmentItem[]
  getTurn: () => 'idle' | 'running'
  getModel: () => string
  getPendingMode: () => RunMode
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>
  setSubmitError: (v: string | null) => void
  setPendingMode: (m: RunMode) => void
  dispatch: (action: { type: string; [key: string]: unknown } | { kind: string; method: string; params: Record<string, unknown> }) => void
}

export interface UseChatSubmissionReturn {
  handleSubmit: () => Promise<void>
}

export function useChatSubmission(opts: UseChatSubmissionOptions): UseChatSubmissionReturn {
  const handleSubmit = useCallback(async () => {
    const text = opts.getInputValue().trim()
    if (!text || opts.getTurn() === 'running') return
    const attachments = opts.getAttachments()
    if (attachments.some(a => a.kind === 'image') && shouldBlockImageSend(opts.getModel())) {
      opts.setSubmitError(`当前模型「${opts.getModel()}」不支持图片。请切到支持视觉的模型,或移除图片后再发。`)
      return
    }
    opts.setInputValue('')
    opts.setSubmitError(null)
    const pendingAttachments = attachments
    opts.setAttachments([])
    opts.dispatch({ type: 'markStarted' })
    opts.dispatch({ type: 'addUserItem', text, attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined })
    try {
      const mode = opts.getPendingMode()
      await window.wraith.submitTurn(
        text,
        pendingAttachments.length > 0 ? pendingAttachments.map(a => ({ path: a.path, kind: a.kind })) : undefined,
        mode,
      )
      opts.setPendingMode(pendingModeAfterSubmit(mode))
    } catch (err) {
      logger.error('wraith', 'submitTurn error:', err)
      opts.dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
      const reason = err instanceof Error ? err.message : String(err)
      const short = reason.replace(/https?:\/\/\S+/g, '').replace(/sk-\S+/g, '').slice(0, 80).trim()
      opts.setSubmitError(short ? `消息发送失败,请重试(${short})` : '消息发送失败,请重试')
    }
  }, [])

  return { handleSubmit }
}