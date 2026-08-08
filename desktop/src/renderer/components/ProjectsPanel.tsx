import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowUp, ArrowDown, Star, Plus, FolderPlus } from 'lucide-react'
import ProjectRow from './ProjectRow'
import ProjectRowMenu from './ProjectRowMenu'
import {
  mergeSummaries, filterProjects, sortProjects, partitionStarredProjects,
  type ProjectRowData, type ProjectSortKey, type SortDir,
} from '../lib/projectsView'
import type { ProjectView, ProjectSummary } from '../../shared/types'

export interface ProjectsPanelProps {
  projects: ProjectView[]
  activePath: string
  busy: boolean
  onOpen: (path: string) => void
  onNewConversation: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onOpenSession: (path: string, sessionId: string) => void
  onRename: (path: string, name: string) => void
  onArchiveChats: (path: string, count: number) => void
  onRemove: (path: string) => void
  onAdd: () => void
}

export default function ProjectsPanel({
  projects, activePath, busy,
  onOpen, onNewConversation, onToggleStar, onOpenSession,
  onRename, onArchiveChats, onRemove, onAdd,
}: ProjectsPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<ProjectSortKey>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [summaries, setSummaries] = useState<ProjectSummary[]>([])
  // 相对时间的统一基准。一次挂载算一次 —— 同屏几十行必须显示同一个"现在"
  const [now] = useState(() => Date.now())

  const paths = projects.map(p => p.path)
  // 依赖数组要稳定的标量,不能直接放数组(每次渲染新数组引用会触发无限拉概况)
  const pathsKey = paths.join('\0')

  useEffect(() => {
    if (paths.length === 0) {
      setSummaries([])
      return
    }
    let alive = true
    void (async () => {
      try {
        const { summaries: got } = await window.wraith.projectSummary(paths)
        if (alive) setSummaries(got)
      } catch (err) {
        // 概况拉不到不该让整页空白:列表照渲染,只是没有会话数与时间
        console.error('[wraith] projectSummary error:', err)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  const rows = useMemo(() => {
    const merged = mergeSummaries(projects, summaries)
    return sortProjects(filterProjects(merged, query), sortKey, sortDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, summaries, query, sortKey, sortDir, projects])

  const { starred, rest } = partitionStarredProjects(rows)

  const clickSort = (key: ProjectSortKey): void => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    // 换列时给各自最自然的初始方向:名称 A→Z、时间新→旧
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  const renderRow = (r: ProjectRowData): JSX.Element => (
    <ProjectRow
      key={r.view.path}
      row={r}
      active={r.view.path === activePath}
      busy={busy}
      now={now}
      onOpen={onOpen}
      onNewConversation={onNewConversation}
      onToggleStar={onToggleStar}
      onOpenSession={onOpenSession}
      menu={
        <ProjectRowMenu
          row={r}
          active={r.view.path === activePath}
          onRename={onRename}
          onArchiveChats={onArchiveChats}
          onRemove={onRemove}
        />
      }
    />
  )

  if (projects.length === 0) {
    return (
      <div data-testid="projects-panel" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <FolderPlus className="h-10 w-10 text-fg-subtle" strokeWidth={1.25} />
        <p data-testid="projects-empty" className="text-sm text-fg-muted">还没有项目</p>
        <button
          data-testid="projects-add"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />添加项目
        </button>
      </div>
    )
  }

  const SortArrow = sortDir === 'asc' ? ArrowUp : ArrowDown

  return (
    <div data-testid="projects-panel" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-fg">项目</h1>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" strokeWidth={1.5} />
          <input
            data-testid="projects-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索项目"
            className="w-full rounded-full border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </div>

        <div className="mt-6 flex items-center gap-1 border-b border-border px-2 pb-2 text-xs text-fg-muted">
          <button
            data-testid="projects-sort-name"
            onClick={() => clickSort('name')}
            className={'flex items-center gap-1 rounded px-1 hover:text-fg ' + (sortKey === 'name' ? 'text-fg' : '')}
          >
            名称{sortKey === 'name' && <SortArrow className="h-3 w-3" strokeWidth={2} />}
          </button>
          <div className="flex-1" />
          <button
            data-testid="projects-sort-updated"
            onClick={() => clickSort('updated')}
            className={'flex items-center gap-1 rounded px-1 hover:text-fg ' + (sortKey === 'updated' ? 'text-fg' : '')}
          >
            已更新{sortKey === 'updated' && <SortArrow className="h-3 w-3" strokeWidth={2} />}
          </button>
          <span className="w-24 shrink-0" aria-hidden />
        </div>

        {rows.length === 0 && (
          <p data-testid="projects-no-match" className="py-8 text-center text-xs text-fg-subtle">
            没有匹配的项目
          </p>
        )}

        {starred.length > 0 && (
          <>
            <div
              data-testid="projects-starred-section"
              className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-3xs text-fg-subtle"
            >
              <Star className="h-3 w-3" strokeWidth={1.5} />重点
            </div>
            {starred.map(renderRow)}
          </>
        )}
        {rest.map(renderRow)}

        <button
          data-testid="projects-add"
          onClick={onAdd}
          className="mt-4 flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-fg-muted hover:bg-fg/5 hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />添加项目…
        </button>
      </div>
    </div>
  )
}
