import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkbenchTab } from '../components/WorkbenchTabBar'
import { makeFileTab } from '../components/WorkbenchTabBar'
import { useWorkspaceTabsReset } from './useWorkspaceTabsReset'

/**
 * 工作台(Workbench)状态管理:文件浏览器可见性、宽度、Tab 页签与拖拽调整。
 *
 * 把 App.tsx 中散落在 L230-297 的 70 行相关逻辑集中到这里,保持 App 只做装配。
 */
export interface UseWorkbenchReturn {
  tabs: WorkbenchTab[]
  activeTabId: string
  setTabs: React.Dispatch<React.SetStateAction<WorkbenchTab[]>>
  setActiveTabId: (id: string) => void
  fileTreeVisible: boolean
  setFileTreeVisible: (v: boolean) => void
  fileTreeWidth: number
  setFileTreeWidth: (w: number) => void
  resizingRef: React.MutableRefObject<{ startX: number; startW: number } | null>
  handleOpenWorkspaceFile: (absPath: string) => void
  handleCloseTab: (fileId: Extract<WorkbenchTab['id'], `file:${string}`>) => void
  handleActivateTab: (id: WorkbenchTab['id']) => void
  handleOpenWorkspace: () => void
  onResizeMouseDown: (e: React.MouseEvent) => void
}

export function useWorkbench(workspace: string | null): UseWorkbenchReturn {
  const [tabs, setTabs] = useState<WorkbenchTab[]>(() => [{ id: 'chat', title: '聊天' }])
  const [activeTabId, setActiveTabId] = useState<string>('chat')
  const [fileTreeVisible, setFileTreeVisible] = useState<boolean>(() => {
    try { return localStorage.getItem('wraith.workbench.fileTreeVisible') === '1' } catch { return false }
  })
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(() => {
    try {
      const w = parseInt(localStorage.getItem('wraith.workbench.fileTreeWidth') ?? '', 10)
      return Number.isFinite(w) && w >= 200 && w <= 560 ? w : 260
    } catch { return 260 }
  })
  const resizingRef = useRef<{ startX: number; startW: number } | null>(null)

  // 切 workspace 即清 file tab:tab 持有绝对路径,切项目后旧路径已失效
  useWorkspaceTabsReset(workspace ?? '', setTabs, setActiveTabId)

  const handleOpenWorkspaceFile = useCallback((absPath: string) => {
    const tid = `file:${absPath}` as const
    setTabs(prev => {
      if (prev.some(t => t.id === tid)) return prev
      return [...prev, makeFileTab(absPath)]
    })
    setActiveTabId(tid as string)
  }, [])

  const handleCloseTab = useCallback((fileId: Extract<WorkbenchTab['id'], `file:${string}`>) => {
    setTabs(prev => {
      if (prev.length === 0) return prev
      const idx = prev.findIndex(t => t.id === fileId)
      if (idx === -1) return prev
      const next = [...prev]
      next.splice(idx, 1)
      setActiveTabId(cur => {
        if (cur !== fileId) return cur
        const neighbor = next[idx] ?? next[idx - 1] ?? next[0]
        return neighbor ? neighbor.id : 'chat'
      })
      return next.length === 0 ? [{ id: 'chat', title: '聊天' } as WorkbenchTab] : next
    })
  }, [])

  const handleActivateTab = useCallback((id: WorkbenchTab['id']) => {
    setActiveTabId(id as string)
  }, [])

  const handleOpenWorkspace = useCallback(() => {
    setFileTreeVisible(true)
  }, [])

  // Workbench 文件树分隔线拖拽
  const onResizeMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    resizingRef.current = { startX: e.clientX, startW: fileTreeWidth }
    const onMove = (ev: MouseEvent): void => {
      const r = resizingRef.current; if (!r) return
      const next = Math.min(560, Math.max(200, r.startW + (ev.clientX - r.startX)))
      setFileTreeWidth(next)
    }
    const onUp = (ev: MouseEvent): void => {
      void ev
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem('wraith.workbench.fileTreeVisible', fileTreeVisible ? '1' : '0')
      localStorage.setItem('wraith.workbench.fileTreeWidth', String(fileTreeWidth))
    } catch { /* 忽略 */ }
  }, [fileTreeVisible, fileTreeWidth])

  return {
    tabs, activeTabId, setTabs, setActiveTabId,
    fileTreeVisible, setFileTreeVisible,
    fileTreeWidth, setFileTreeWidth,
    resizingRef,
    handleOpenWorkspaceFile, handleCloseTab, handleActivateTab,
    handleOpenWorkspace, onResizeMouseDown,
  }
}
