import { PanelLeft } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

interface TopBarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

/** 全宽顶条:窗口拖拽区(macOS 隐藏原生标题栏后)+ 常驻折叠键(紧挨交通灯右侧)。 */
export default function TopBar({ collapsed, onToggleCollapsed }: TopBarProps): JSX.Element {
  const pad = topBarLeftPad(window.wraith.platform)
  return (
    <div className={'flex h-[38px] shrink-0 items-center border-b border-border bg-bg [-webkit-app-region:drag] ' + pad}>
      <button
        type="button"
        data-testid="sidebar-collapse"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧栏' : '折叠侧栏'}
        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface/60 hover:text-fg [-webkit-app-region:no-drag]"
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}
