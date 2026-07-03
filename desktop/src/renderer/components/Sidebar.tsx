import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import ProjectSwitcher from './ProjectSwitcher'
import type { SessionMeta, ProjectView } from '../../shared/types'

interface SidebarProps {
  workspace: string
  projects: ProjectView[]
  busy: boolean
  sessions: SessionMeta[]
  activeSessionId: string
  onNewConversation: () => void
  onSelectSession: (id: string) => void
  onActivateProject: (path: string) => void
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onRenameProject: (path: string, name: string) => void
  sandbox: 'macos-seatbelt' | 'none' | 'unknown'
  activeNav: 'plugins' | 'automations' | null
  onOpenPlugins: () => void
  onOpenAutomations: () => void
  automationBadge: boolean
}

const NAV_DISABLED: { key: string; label: string; hint: string }[] = [
  { key: 'search', label: '搜索', hint: '搜索在后续阶段' },
]

export default function Sidebar({
  workspace,
  projects,
  busy,
  sessions,
  activeSessionId,
  onNewConversation,
  onSelectSession,
  onActivateProject,
  onAddProject,
  onRemoveProject,
  onRenameProject,
  sandbox,
  activeNav,
  onOpenPlugins,
  onOpenAutomations,
  automationBadge,
}: SidebarProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-testid="sidebar"
        className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-accent">✦</span>
          <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
        </div>

        <ProjectSwitcher
          projects={projects}
          activePath={workspace}
          busy={busy}
          onActivate={onActivateProject}
          onAdd={onAddProject}
          onRemove={onRemoveProject}
          onRename={onRenameProject}
        />

        {/* new conversation — functional */}
        <div className="px-3">
          <button
            data-testid="new-conversation"
            onClick={onNewConversation}
            className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent hover:text-accent"
          >
            ＋ 新对话
          </button>
        </div>

        {/* nav */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {/* search — disabled placeholder */}
          {NAV_DISABLED.filter(n => n.key === 'search').map(n => (
            <Tooltip key={n.key}>
              <TooltipTrigger asChild>
                <button
                  data-testid={`nav-${n.key}`}
                  disabled
                  className="rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
                >
                  {n.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{n.hint}</TooltipContent>
            </Tooltip>
          ))}

          {/* plugins — enabled */}
          <button
            data-testid="nav-plugins"
            onClick={onOpenPlugins}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'plugins' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            插件
          </button>

          {/* automations — enabled */}
          <button
            data-testid="nav-automations"
            onClick={onOpenAutomations}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'automations' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center">
              自动化
              {automationBadge && (
                <span data-testid="nav-automations-badge" className="relative ml-auto flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                </span>
              )}
            </span>
          </button>
        </nav>

        {/* conversations — from session.list */}
        <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">对话</div>
        <div className="flex-1 overflow-y-auto px-3">
          {sessions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                data-testid="conversation-item"
                onClick={() => onSelectSession(s.id)}
                className={
                  'mb-0.5 block w-full truncate rounded-lg px-3 py-2 text-left text-xs ' +
                  (s.id === activeSessionId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')
                }
                title={s.title}
              >
                {s.title || '(未命名)'}
              </button>
            ))
          )}
        </div>

        {/* footer: sandbox badge */}
        <div className="border-t border-border px-3 py-3">
          <div
            data-testid="sandbox-badge"
            className={
              'mt-2 truncate text-[11px] ' +
              (sandbox === 'none' ? 'text-danger' : 'text-fg-subtle')
            }
            title={sandbox === 'none' ? '命令未在沙箱内执行' : sandbox === 'macos-seatbelt' ? '命令在 Seatbelt 沙箱内执行' : '沙箱状态未知'}
          >
            {sandbox === 'none' ? '⚠ 沙箱未启用' : sandbox === 'macos-seatbelt' ? '🛡 沙箱: Seatbelt' : '沙箱: —'}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
