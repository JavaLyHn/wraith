import { useEffect, useRef } from 'react'
import type { WorkbenchTab } from '../components/WorkbenchTabBar'

/**
 * 切 workspace 即清文件 tab。
 *
 * file tab 持有的是绝对路径:切换项目后旧路径在新 workspace 下已失效,
 * 残留的 tab 点开只会「预览失败」(旧目录已删)或误导性显示旧项目内容
 * (跨项目同名文件仍存在)。因此 workspace 真正变化时把 tab 栏重置回
 * 仅「聊天」并回到 chat —— 与 App 里「切/建会话即清 compactNotice」
 * 的 effect 范式一致;首挂与同值 re-render 不触发。
 */
export function useWorkspaceTabsReset(
  workspace: string,
  setTabs: (tabs: WorkbenchTab[]) => void,
  setActiveTabId: (id: string) => void,
): void {
  const prevWorkspaceRef = useRef(workspace)
  useEffect(() => {
    if (prevWorkspaceRef.current === workspace) return
    prevWorkspaceRef.current = workspace
    setTabs([{ id: 'chat', title: '聊天' }])
    setActiveTabId('chat')
  }, [workspace, setTabs, setActiveTabId])
}
