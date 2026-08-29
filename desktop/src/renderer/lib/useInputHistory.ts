import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_HISTORY = 100

export interface UseInputHistoryOptions {
  sessionId: string
  /** 当用户在浏览历史时,需要回填到 Composer 的 value setter */
  onValueChange: (v: string) => void
}

export interface UseInputHistoryReturn {
  /** 当前会话的历史条目(旧→新) */
  history: string[]
  /** 当前浏览指针;-1 = 不在浏览模式 */
  historyIndex: number
  /** 是否处于历史浏览模式 */
  isBrowsing: boolean
  /** ↑ 键:上翻一条历史,返回回填的文本;到头时返回 null */
  goOlder: () => string | null
  /** ↓ 键:下翻一条历史,返回回填的文本;到最新或退出时返回 null */
  goNewer: () => string | null
  /** 用户开始新输入时调用:退出浏览模式,清空指针 */
  exitBrowsing: () => void
  /** 提交成功后调用:将文本追加到历史 */
  addToHistory: (text: string) => void
  /** 切会话时调用:加载新会话的历史 */
  loadHistory: (sessionId: string) => void
}

export function useInputHistory(opts: UseInputHistoryOptions): UseInputHistoryReturn {
  const { sessionId, onValueChange } = opts
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const historyRef = useRef<string[]>([])
  const indexRef = useRef<number>(-1)
  /** 用于忽略过期的异步 loadHistory 结果 */
  const loadIdRef = useRef(0)

  const syncRefs = () => {
    historyRef.current = history
    indexRef.current = historyIndex
  }
  syncRefs()

  const loadHistory = useCallback((sid: string) => {
    const myId = ++loadIdRef.current
    if (!sid) {
      setHistory([])
      setHistoryIndex(-1)
      return
    }
    void window.wraith.inputHistory.get(sid).then(entries => {
      // 只接受最新一次请求的结果,忽略过期异步返回
      if (myId !== loadIdRef.current) return
      setHistory(entries)
      setHistoryIndex(-1)
    })
  }, [])

  useEffect(() => {
    loadHistory(sessionId)
  }, [sessionId, loadHistory])

  const goOlder = useCallback((): string | null => {
    const h = historyRef.current
    if (h.length === 0) return null
    const nextIdx = indexRef.current < 0 ? h.length - 1 : Math.max(0, indexRef.current - 1)
    setHistoryIndex(nextIdx)
    const entry = h[nextIdx]
    onValueChange(entry)
    return entry
  }, [onValueChange])

  const goNewer = useCallback((): string | null => {
    const h = historyRef.current
    if (indexRef.current < 0) return null
    const nextIdx = indexRef.current + 1
    if (nextIdx >= h.length) {
      setHistoryIndex(-1)
      onValueChange('')
      return null
    }
    setHistoryIndex(nextIdx)
    const entry = h[nextIdx]
    onValueChange(entry)
    return entry
  }, [onValueChange])

  const exitBrowsing = useCallback(() => {
    if (indexRef.current >= 0) {
      setHistoryIndex(-1)
    }
  }, [])

  const addToHistory = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const h = historyRef.current
    if (h.length > 0 && h[h.length - 1] === trimmed) {
      // 与最近一条相同,跳过
      return
    }

    const updated = [...h, trimmed]
    const trimmedList = updated.length > MAX_HISTORY
      ? updated.slice(-MAX_HISTORY)
      : updated
    setHistory(trimmedList)
    setHistoryIndex(-1)
    if (sessionId) {
      void window.wraith.inputHistory.add(sessionId, trimmed)
    }
  }, [sessionId])

  return {
    history,
    historyIndex,
    isBrowsing: historyIndex >= 0,
    goOlder,
    goNewer,
    exitBrowsing,
    addToHistory,
    loadHistory,
  }
}
