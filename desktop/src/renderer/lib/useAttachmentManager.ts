import { useCallback, useState } from 'react'
import type { AttachmentItem } from '../components/Composer'

/**
 * 附件管理 hook:管理 Composer 提交的附件列表。
 */
export function useAttachmentManager() {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])

  const handlePickAttachments = useCallback(async (): Promise<void> => {
    try {
      const picked = await window.wraith.pickAttachments()
      if (picked.length > 0) {
        setAttachments(prev => [...prev, ...picked])
      }
    } catch (err) {
      console.error('[wraith] pickAttachments error:', err)
    }
  }, [])

  const handleRemoveAttachment = useCallback((index: number): void => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleAddAttachments = useCallback((items: AttachmentItem[]): void => {
    if (items.length > 0) setAttachments(prev => [...prev, ...items])
  }, [])

  return { attachments, setAttachments, handlePickAttachments, handleRemoveAttachment, handleAddAttachments }
}
