import { useEffect, useState } from 'react'
import { logger } from '../lib/logger'
import { Search, Undo2, Trash2, Check, Archive } from 'lucide-react'
import Select from './ui/select'
import { buildArchiveRows, filterArchive, archiveProjectOptions, type ArchiveRowData } from '../lib/archiveView'
import { shortRelativeTime } from '../lib/projectsView'
import type { SessionMeta, ProjectView } from '../../shared/types'

export interface SettingsArchiveProps {
  /** 归档集合变了 → 让 App 重拉侧栏会话列表(恢复的可能是当前项目的会话) */
  onArchiveChanged: () => void
}

/**
 * 「归档于 3 小时前」/「刚刚归档」。
 * 不能直接写 `归档于 ${shortRelativeTime(...)}前` —— 那在「刚刚」档会渲染成
 * 「归档于 刚刚前」。分档拼句子,不是拼字符串。
 */
function archivedAgo(iso: string | null, now: number): string {
  const rel = shortRelativeTime(iso, now)
  if (rel === '—') return '归档时间未知'
  if (rel === '刚刚') return '刚刚归档'
  return `归档于 ${rel}前`
}

export default function SettingsArchive({ onArchiveChanged }: SettingsArchiveProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { projects: ps } = await window.wraith.listProjects()
        if (!alive) return
        setProjects(ps)
        const { sessions: ss } = await window.wraith.listArchivedSessions(ps.map(p => p.path))
        if (alive) setSessions(ss)
      } catch (err) {
        logger.error('wraith', 'listArchivedSessions error:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const rows = buildArchiveRows(sessions, projects)
  const shown = filterArchive(rows, query, projectFilter || null)

  /** 乐观移除 + 失败回滚。归档区的写操作**必须传 path** —— 它是跨项目列表。 */
  const mutate = async (row: ArchiveRowData, op: 'restore' | 'delete'): Promise<void> => {
    const id = row.meta.id
    const path = row.meta.cwd
    const before = sessions
    setSessions(s => s.filter(x => x.id !== id))   // 乐观
    try {
      const { ok } = op === 'restore'
        ? await window.wraith.setSessionArchived(id, false, path)
        : await window.wraith.deleteSession(id, path)
      if (!ok) {
        setSessions(before)   // 回滚:不能让用户以为成了
        return
      }
      onArchiveChanged()
    } catch (err) {
      logger.error('wraith', 'archive mutate error:', err)
      setSessions(before)
    }
  }

  if (!loading && sessions.length === 0) {
    return (
      <div data-testid="settings-archive" className="flex flex-col items-center gap-3 py-16">
        <Archive className="h-10 w-10 text-fg-subtle" strokeWidth={1.25} />
        <p data-testid="archive-empty" className="text-sm text-fg-muted">还没有归档的聊天</p>
        <p className="text-xs text-fg-subtle">在侧栏的会话上点归档图标即可归档。</p>
      </div>
    )
  }

  return (
    <div data-testid="settings-archive">
      <h2 className="text-sm font-bold text-fg">归档的聊天</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        归档的聊天不在侧栏显示，但内容都还在 —— 恢复后一切照旧。
      </p>

      <div className="mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" strokeWidth={1.5} />
          <input
            data-testid="archive-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索"
            className="w-full rounded-lg border border-border bg-bg py-1.5 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </div>
        <Select
          testId="archive-project-filter"
          options={archiveProjectOptions(rows)}
          value={projectFilter}
          onChange={setProjectFilter}
          className="w-40 shrink-0"
        />
      </div>

      {shown.length === 0 && (
        <p data-testid="archive-no-match" className="py-8 text-center text-xs text-fg-subtle">
          没有匹配的聊天
        </p>
      )}

      <div className="mt-3">
        {shown.map(r => (
          <div
            key={r.meta.id}
            data-testid="archive-row"
            className="group flex items-center gap-2 border-b border-border/60 py-2.5"
            onMouseLeave={() => setConfirmDel(null)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg">{r.displayName}</div>
              <div className="mt-0.5 text-3xs text-fg-subtle">
                {r.projectLabel} · {r.meta.turns} 轮 · {archivedAgo(r.meta.archivedAt ?? null, now)}
              </div>
            </div>
            <button
              data-testid="archive-restore"
              title="恢复到侧栏"
              onClick={() => void mutate(r, 'restore')}
              className="shrink-0 rounded p-1 text-fg-subtle opacity-0 hover:text-accent group-hover:opacity-100"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              data-testid="archive-delete"
              title={confirmDel === r.meta.id ? '确认永久删除?' : '永久删除'}
              onClick={() => {
                if (confirmDel !== r.meta.id) { setConfirmDel(r.meta.id); return }
                setConfirmDel(null)
                void mutate(r, 'delete')
              }}
              className={'shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 ' +
                (confirmDel === r.meta.id ? 'text-danger opacity-100' : 'text-fg-subtle hover:text-danger')}
            >
              {confirmDel === r.meta.id
                ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
