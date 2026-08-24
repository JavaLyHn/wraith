import { useEffect, useState } from 'react'

/**
 * 侧栏折叠状态(localStorage 持久化)。
 *
 * 把 App.tsx L361-389 的 sidebarCollapsed + fileTreeVisible 持久化逻辑集中到这里。
 */
export interface UseSidebarCollapseReturn {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  sidebarPeek: boolean
  setSidebarPeek: (v: boolean) => void
}

export function useSidebarCollapse(): UseSidebarCollapseReturn {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('wraith.sidebar.collapsed') === '1' } catch { return false }
  })
  const [sidebarPeek, setSidebarPeek] = useState(false)

  useEffect(() => {
    try { localStorage.setItem('wraith.sidebar.collapsed', sidebarCollapsed ? '1' : '0') } catch { /* ignore */ }
  }, [sidebarCollapsed])

  return { sidebarCollapsed, setSidebarCollapsed, sidebarPeek, setSidebarPeek }
}
