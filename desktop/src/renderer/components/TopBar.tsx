import { type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

interface TopBarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 右上角动作簇(如终端/右侧面板键);缺省则右侧留空。整簇自动 no-drag。 */
  right?: ReactNode
}

/** 全宽顶条:窗口拖拽区(macOS 隐藏原生标题栏后)+ 折叠键(左,紧挨交通灯)+ 可选右动作簇。 */
export default function TopBar({ collapsed, onToggleCollapsed, right }: TopBarProps): JSX.Element {
  const pad = topBarLeftPad(window.wraith.platform)
  const isMac = window.wraith.platform === 'darwin'
  return (
    <div className={'flex h-[38px] shrink-0 items-center border-b border-border [-webkit-app-region:drag] ' + (isMac ? '' : 'bg-bg ') + pad}>
      <button
        type="button"
        data-testid="sidebar-collapse"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧栏' : '折叠侧栏'}
        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface/60 hover:text-fg [-webkit-app-region:no-drag]"
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      {right && (
        <div className="ml-auto flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
          {right}
        </div>
      )}
    </div>
  )
}
