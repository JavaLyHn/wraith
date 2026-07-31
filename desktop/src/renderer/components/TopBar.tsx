import PanelToggleIcon from './PanelToggleIcon'
import WindowControls from './WindowControls'
import { topBarLeftPad, shouldShowWindowControls } from '../lib/topBar'

/** 贯通整窗顶栏:左簇=交通灯内衬 + 侧栏切换(恒显);右簇=终端 + 右栏(恒显);中段 drag。
 *  三键用 Codex 式自绘 glyph(PanelToggleIcon):分隔线滑动+填充、单色墨;hover 显柔底、开态常驻。 */
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
  // 纯平单色墨:状态只用墨色表达——开=深墨(text-fg)、关=浅墨(text-fg-muted)、hover=深墨。
  // 不再有任何灰底/凸起(去掉开态与 hover 的 bg,避免读作"阴影/凸起")。
  const btn = (open: boolean): string =>
    'flex items-center rounded-[10px] p-1.5 transition duration-150 active:scale-90 motion-reduce:transform-none [-webkit-app-region:no-drag] ' +
    (open ? 'text-fg' : 'text-fg-muted hover:text-fg')
  return (
    <div data-testid="topbar" className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(platform)}>
      <button data-testid="sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} className={btn(!sidebarCollapsed)} aria-pressed={!sidebarCollapsed}>
        <PanelToggleIcon side="left" open={!sidebarCollapsed} />
      </button>
      <div className="flex-1" />
      {showChat && (
        <div className="flex items-center gap-1 pr-2">
          <button data-testid="terminal-toggle" onClick={onToggleTerminal} title="终端" className={btn(terminalOpen)} aria-pressed={terminalOpen}>
            <PanelToggleIcon side="bottom" open={terminalOpen} />
          </button>
          <button data-testid="rightdock-toggle" onClick={onToggleRightDock} title="右侧面板(浏览器/终端)" className={btn(rightDockOpen)} aria-pressed={rightDockOpen}>
            <PanelToggleIcon side="right" open={rightDockOpen} />
          </button>
        </div>
      )}
      {shouldShowWindowControls(platform) && <WindowControls platform={platform} />}
    </div>
  )
}
