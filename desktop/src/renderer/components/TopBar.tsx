import { Shield, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react'
import PanelToggleIcon from './PanelToggleIcon'
import WindowControls from './WindowControls'
import { topBarLeftPad, shouldShowWindowControls, sandboxChipView, type SandboxState } from '../lib/topBar'

/** 贯通整窗顶栏:左簇=交通灯内衬 + 侧栏切换(恒显);右簇=沙箱盾 + 终端 + 右栏;中段 drag。
 *  三键用 Codex 式自绘 glyph(PanelToggleIcon):分隔线滑动+填充、单色墨;hover 显柔底、开态常驻。 */
export default function TopBar({ platform, sidebarCollapsed, onToggleSidebar, showChat, terminalOpen, onToggleTerminal, rightDockOpen, onToggleRightDock, sandbox, sandboxNet = false, onOpenPolicy }: {
  platform: string
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  showChat: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  rightDockOpen: boolean
  onToggleRightDock: () => void
  sandbox: SandboxState
  /** 沙箱是否放行了网络出口。默认 false —— 拿不准时按最强姿态显示,不要凭空说「已放行」。 */
  sandboxNet?: boolean
  onOpenPolicy: () => void
}): JSX.Element {
  // 纯平单色墨:状态只用墨色表达——开=深墨(text-fg)、关=浅墨(text-fg-muted)、hover=深墨。
  // 不再有任何灰底/凸起(去掉开态与 hover 的 bg,避免读作"阴影/凸起")。
  const btn = (open: boolean): string =>
    'flex items-center rounded-[10px] p-1.5 transition duration-150 active:scale-90 motion-reduce:transform-none [-webkit-app-region:no-drag] ' +
    (open ? 'text-fg' : 'text-fg-muted hover:text-fg')

  const sb = sandboxChipView(sandbox, platform, sandboxNet)
  // 半盾 = 沙箱在,但有一面是开的(网络)。跟 plain Shield(平台无沙箱/状态未知)刻意分开:
  // 那两种是「什么都没有」,这种是「关了一半」,画成同一个图形会把用户教错。
  const SbIcon = sb.kind === 'ok' ? ShieldCheck
    : sb.kind === 'ok-net' ? ShieldHalf
      : sb.kind === 'off' ? ShieldAlert : Shield

  return (
    <div data-testid="topbar" className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(platform)}>
      <button data-testid="sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} className={btn(!sidebarCollapsed)} aria-pressed={!sidebarCollapsed}>
        <PanelToggleIcon side="left" open={!sidebarCollapsed} />
      </button>
      <div className="flex-1" />
      {/* 右簇。沙箱盾**不跟 showChat 走** —— 在任何面板页都该看得见命令有没有沙箱;
          终端/右栏两键只在对话页有意义。整簇共用一个 pr-2,免得盾单独在时贴到窗沿。 */}
      <div className="flex items-center gap-1 pr-2">
        <button
          data-testid="sandbox-badge"
          onClick={onOpenPolicy}
          aria-label={sb.label}
          title={sb.title}
          className={'flex items-center rounded-[10px] p-1.5 transition duration-150 active:scale-90 motion-reduce:transform-none [-webkit-app-region:no-drag] ' + sb.tone}
        >
          <SbIcon className="h-4 w-4" strokeWidth={1.5} />
        </button>
        {showChat && (
          <>
            <button data-testid="terminal-toggle" onClick={onToggleTerminal} title="终端" className={btn(terminalOpen)} aria-pressed={terminalOpen}>
              <PanelToggleIcon side="bottom" open={terminalOpen} />
            </button>
            <button data-testid="rightdock-toggle" onClick={onToggleRightDock} title="右侧面板(浏览器/终端)" className={btn(rightDockOpen)} aria-pressed={rightDockOpen}>
              <PanelToggleIcon side="right" open={rightDockOpen} />
            </button>
          </>
        )}
      </div>
      {shouldShowWindowControls(platform) && <WindowControls platform={platform} />}
    </div>
  )
}
