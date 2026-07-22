import { PanelLeft, PanelRight, SquareTerminal } from 'lucide-react'
import { topBarLeftPad } from '../lib/topBar'

/** 贯通整窗顶栏:左簇=交通灯内衬 + 侧栏切换(恒显);右簇=终端 + 右栏(恒显);中段 drag。 */
export default function TopBar({ platform, sidebarCollapsed, onToggleSidebar, showChat, terminalOpen, onToggleTerminal, rightDockOpen, onToggleRightDock }: {
  platform: string
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  showChat: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  rightDockOpen: boolean
  onToggleRightDock: () => void
}): JSX.Element {
  const btn = (active: boolean): string =>
    'flex items-center rounded-lg p-1.5 text-xs transition duration-150 active:scale-90 motion-reduce:transform-none hover:bg-fg/5 hover:text-fg [-webkit-app-region:no-drag] ' + (active ? 'text-accent' : 'text-fg-muted')
  return (
    <div data-testid="topbar" className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(platform)}>
      <button data-testid="sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} className={btn(false)}>
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1" />
      {showChat && (
        <div className="flex items-center gap-1 pr-2">
          <button data-testid="terminal-toggle" onClick={onToggleTerminal} title="终端" className={btn(terminalOpen)}>
            <SquareTerminal className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button data-testid="rightdock-toggle" onClick={onToggleRightDock} title="右侧面板(浏览器/终端)" className={btn(rightDockOpen)}>
            <PanelRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  )
}
