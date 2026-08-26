import { useCallback, useRef, useState } from 'react'
import { transcriptToMarkdown } from './transcriptMarkdown'
import { compactionNotice } from './compactView'

export interface UseExportAndCompactOptions {
  getItems: () => Array<{ type: string; text?: string }>
  getModel: () => string
  getWorkspace: () => string | null
  getTurn: () => 'idle' | 'running'
}

export interface UseExportAndCompactReturn {
  compactBusy: boolean
  compactNotice: string | null
  compactDisabled: boolean
  handleCompact: () => Promise<void>
  handleExport: () => Promise<void>
  clearCompactNotice: () => void
}

export function useExportAndCompact(opts: UseExportAndCompactOptions): UseExportAndCompactReturn {
  const [compactBusy, setCompactBusy] = useState(false)
  const [compactNotice, setCompactNotice] = useState<string | null>(null)
  const compactNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashCompactNotice = useCallback((msg: string | null): void => {
    if (compactNoticeTimer.current) {
      clearTimeout(compactNoticeTimer.current)
      compactNoticeTimer.current = null
    }
    setCompactNotice(msg)
    if (msg) {
      compactNoticeTimer.current = setTimeout(() => {
        setCompactNotice(null)
        compactNoticeTimer.current = null
      }, 6000)
    }
  }, [])

  const handleCompact = useCallback(async (): Promise<void> => {
    if (opts.getTurn() === 'running') return
    setCompactBusy(true)
    flashCompactNotice(null)
    try {
      flashCompactNotice(compactionNotice(await window.wraith.compactHistory()))
    } catch (err) {
      flashCompactNotice('❌ 压缩失败:' + ((err as Error).message || '未知错误'))
    } finally {
      setCompactBusy(false)
    }
  }, [flashCompactNotice])

  const handleExport = useCallback(async (): Promise<void> => {
    const items = opts.getItems()
    if (!items.length) return
    const firstUser = items.find((i) => i.type === 'user') as { text: string } | undefined
    const rawTitle = (firstUser?.text ?? 'Wraith 对话').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Wraith 对话'
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    const md = transcriptToMarkdown(items as never[], {
      title: rawTitle,
      model: opts.getModel(),
      workspace: opts.getWorkspace() ?? undefined,
      exportedAt: stamp,
    })
    const safeName = rawTitle.replace(/[/\\:*?"<>|]/g, '_').slice(0, 30) || 'wraith-对话'
    const fileStamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
    await window.wraith.saveTextFile(`${safeName}-${fileStamp}.md`, md)
  }, [])

  const clearCompactNotice = useCallback(() => {
    if (compactNoticeTimer.current) {
      clearTimeout(compactNoticeTimer.current)
      compactNoticeTimer.current = null
    }
    setCompactNotice(null)
  }, [])

  const items = opts.getItems()
  const compactDisabled = compactBusy || opts.getTurn() === 'running' || !items.length

  return {
    compactBusy,
    compactNotice,
    compactDisabled,
    handleCompact,
    handleExport,
    clearCompactNotice,
  }
}