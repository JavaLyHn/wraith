import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import type { SessionMeta } from '../../shared/types'

interface SidebarProps {
  workspace: string
  sessions: SessionMeta[]
  activeSessionId: string
  onNewConversation: () => void
  onSelectSession: (id: string) => void
}

const NAV: { key: string; label: string; hint: string }[] = [
  { key: 'search', label: '搜索', hint: '搜索在后续阶段' },
  { key: 'plugins', label: '插件', hint: '插件在 Phase D' },
  { key: 'automation', label: '自动化', hint: '自动化在 Phase D' },
  { key: 'projects', label: '项目', hint: '多项目在 Phase C' },
]

export default function Sidebar({
  workspace,
  sessions,
  activeSessionId,
  onNewConversation,
  onSelectSession,
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

        {/* nav — disabled placeholders */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {NAV.map(n => (
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

        {/* footer: workspace */}
        <div className="border-t border-border px-3 py-3">
          <div className="truncate text-[11px] text-fg-subtle" title={workspace || '默认工作目录'}>
            📁 {baseName(workspace)}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
