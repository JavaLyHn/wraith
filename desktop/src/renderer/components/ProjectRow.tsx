import { useState } from 'react'
import { Folder, ChevronDown, Star, SquarePen } from 'lucide-react'
import { shortRelativeTime, type ProjectRowData } from '../lib/projectsView'
import { sessionDisplayName } from '../lib/sessionView'
import type { SessionMeta } from '../../shared/types'

/** 展开时拉几条会话。超过这个数就出「查看全部」引导去侧栏看全量。 */
const EXPAND_LIMIT = 5

export interface ProjectRowProps {
  row: ProjectRowData
  /** 是否当前工作目录(左侧 accent 竖条) */
  active: boolean
  /** turn 运行中:禁激活/新会话;重点与展开不受限 */
  busy: boolean
  /** 相对时间基准。由外壳统一传,免得每行各取一次 Date.now() 导致同屏时间不一致 */
  now: number
  onOpen: (path: string) => void
  onNewConversation: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onOpenSession: (path: string, sessionId: string) => void
  moveIndex?: number
  group?: 'starred' | 'rest'
  onMove?: (path: string, targetIndex: number) => void
  /** ··· 菜单(Task 10 注入)。行本身不关心它长什么样 */
  menu?: React.ReactNode
}

export default function ProjectRow({
  row, active, busy, now,
  onOpen, onNewConversation, onToggleStar, onOpenSession, menu,
  moveIndex = 0, group = 'rest', onMove,
}: ProjectRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // null = 还没拉过。折叠不清它 —— 折叠再展开不该重复请求
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null)
  const [loading, setLoading] = useState(false)

  const { view, displayName, sessionCount, lastSessionAt } = row
  const path = view.path
  const starred = view.starred === true
  const missing = !view.exists

  const toggleExpand = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    if (!next || sessions !== null || loading) return
    setLoading(true)
    try {
      const { sessions: list } = await window.wraith.listSessionsForProject(path, EXPAND_LIMIT)
      setSessions(list)
    } catch (err) {
      console.error('[wraith] listSessionsForProject error:', err)
      setSessions([])   // 置空数组而不是留 null,免得每次展开都重试
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="project-row" draggable={!!onMove} onDragStart={e => { e.dataTransfer.setData('text/plain', path); e.dataTransfer.setData('application/x-wraith-project-group', group) }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const source = e.dataTransfer.getData('text/plain'); const sourceGroup = e.dataTransfer.getData('application/x-wraith-project-group'); if (source && sourceGroup === group) onMove?.(source, moveIndex) }} className="border-b border-border/60">
      <div className={'group flex items-center gap-1 px-2 ' + (active ? 'relative' : '')}>
        {active && (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
        )}
        <Folder className="ml-1 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
        {!missing && (
          <button
            data-testid="project-row-expand"
            aria-label={expanded ? '收起会话' : '展开会话'}
            onClick={toggleExpand}
            className="shrink-0 rounded p-0.5 text-fg-subtle hover:text-fg"
          >
            <ChevronDown
              className={'h-3.5 w-3.5 transition-transform ' + (expanded ? '' : '-rotate-90')}
              strokeWidth={1.5}
            />
          </button>
        )}
        <button
          data-testid="project-row-open"
          disabled={busy || missing}
          title={missing ? '目录不存在' : path}
          onClick={() => onOpen(path)}
          className={'flex min-w-0 flex-1 items-baseline gap-2 py-3 text-left disabled:cursor-not-allowed ' +
            (missing ? 'opacity-50' : '')}
        >
          <span className="truncate text-sm text-fg">{displayName}</span>
          {!missing && sessionCount !== null && (
            <span className="shrink-0 text-3xs text-fg-subtle">
              · {sessionCount === 0 ? '无会话' : `${sessionCount} 会话`}
            </span>
          )}
        </button>
        {missing ? (
          <span data-testid="project-row-missing" className="shrink-0 text-xs text-fg-subtle">目录不存在</span>
        ) : (
          <span className="w-16 shrink-0 text-right text-xs text-fg-muted">
            {shortRelativeTime(lastSessionAt, now)}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5 pl-2">
          {menu}
          {!missing && (
            <>
              <button
                data-testid="project-row-star"
                title={starred ? '取消重点' : '标记重点'}
                onClick={() => onToggleStar(path, !starred)}
                className={'rounded p-1 ' + (starred
                  ? 'text-warn'
                  : 'text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100')}
              >
                <Star className="h-3.5 w-3.5" strokeWidth={1.5} fill={starred ? 'currentColor' : 'none'} />
              </button>
              <button
                data-testid="project-row-new"
                disabled={busy}
                title="在此项目新建对话"
                onClick={() => onNewConversation(path)}
                className="rounded p-1 text-fg-subtle opacity-0 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
              >
                <SquarePen className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pb-2 pl-10 pr-2">
          {loading && <div className="py-1.5 text-xs text-fg-subtle">载入中…</div>}
          {!loading && sessions !== null && sessions.length === 0 && (
            <div className="py-1.5 text-xs text-fg-subtle">这个项目还没有会话</div>
          )}
          {!loading && sessions?.map(s => (
            <button
              key={s.id}
              data-testid="project-row-session"
              disabled={busy}
              onClick={() => onOpenSession(path, s.id)}
              className="flex w-full items-baseline gap-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate text-xs text-fg-muted hover:text-fg">{sessionDisplayName(s)}</span>
              <span className="ml-auto shrink-0 text-3xs text-fg-subtle">
                {shortRelativeTime(s.updatedAt, now)}
              </span>
            </button>
          ))}
          {!loading && sessions !== null && sessionCount !== null && sessionCount > sessions.length && (
            <button
              data-testid="project-row-view-all"
              disabled={busy}
              onClick={() => onOpen(path)}
              className="py-1.5 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              在此项目中查看全部 →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
