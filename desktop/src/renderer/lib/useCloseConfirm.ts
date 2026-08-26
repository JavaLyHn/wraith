import { useCallback, useEffect, useState } from 'react'

/**
 * 关闭确认对话框 hook:监听主进程 'wraith:close:request' 事件。
 *
 * 若用户已记住 closeMode≠'ask' 则直接执行;否则弹 CloseConfirmModal 让用户选择。
 */
export function useCloseConfirm() {
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const off = window.wraith.closeBehavior.onRequest(async () => {
      if (cancelled) return
      try {
        const mode = await window.wraith.closeBehavior.getMode()
        if (mode === 'background' || mode === 'quit') {
          await window.wraith.closeBehavior.execute({ mode, remember: null })
        } else {
          setCloseConfirmOpen(true)
        }
      } catch {
        setCloseConfirmOpen(true)
      }
    })
    return () => { cancelled = true; off() }
  }, [])

  const handleCloseConfirm = useCallback(async (mode: 'background' | 'quit', remember: boolean) => {
    setCloseConfirmOpen(false)
    try {
      await window.wraith.closeBehavior.execute({ mode, remember: remember ? mode : null })
    } catch {
      // best-effort
    }
  }, [])

  const handleCloseConfirmCancel = useCallback((): void => {
    setCloseConfirmOpen(false)
  }, [])

  return { closeConfirmOpen, setCloseConfirmOpen, handleCloseConfirm, handleCloseConfirmCancel }
}
