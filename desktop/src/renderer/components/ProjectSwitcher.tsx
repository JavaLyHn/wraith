import { useState } from 'react'
import { Folder, ChevronDown, Star, Plus, List } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import type { ProjectView } from '../../shared/types'

/** 非重点项目在下拉里最多列几个。重点全列,不占这个配额。 */
const RECENT_LIMIT = 5

interface ProjectSwitcherProps {
  projects: ProjectView[]
  /** 当前活跃项目路径(= state.workspace)。 */
  activePath: string
  /** turn 运行中:禁激活/添加。 */
  busy: boolean
  onActivate: (path: string) => void
  onAdd: () => void
  /** 进「项目」面板看全量(搜索 / 排序 / 整理 / 看会话都在那儿)。 */
  onOpenAllProjects: () => void
}

/**
 * 侧栏的项目快切下拉。**只负责切**:列重点 + 最近 5 个,不做改名/移出 ——
 * 那些搬进了「项目」面板,同一个操作不该有两套 UI 和两套代码路径。
 */
export default function ProjectSwitcher({
  projects, activePath, busy, onActivate, onAdd, onOpenAllProjects,
}: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)

  const displayName = (p: ProjectView): string => p.name || baseName(p.path)
  const active = projects.find(p => p.path === activePath)

  const starred = projects.filter(p => p.starred)
  const recent = projects.filter(p => !p.starred).slice(0, RECENT_LIMIT)
  const shown = [...starred, ...recent]

  const item = (p: ProjectView): JSX.Element => (
    <button
      key={p.path}
      data-testid="project-item"
      disabled={busy || !p.exists}
      title={p.exists ? p.path : '目录不存在'}
      onClick={() => {
        setOpen(false)
        if (p.path !== activePath) onActivate(p.path)   // 点当前项目=只收面板
      }}
      className={'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-60 ' +
        (p.path === activePath ? 'bg-surface text-fg' : 'text-fg-muted enabled:hover:bg-surface/60')}
    >
      {p.starred && <Star className="h-3 w-3 shrink-0 text-warn" strokeWidth={1.5} fill="currentColor" />}
      <span className="truncate">{displayName(p)}</span>
      {p.path === activePath && <span className="ml-auto shrink-0 text-fg-subtle">✓</span>}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="project-switcher"
          title={activePath || '默认工作目录'}
          className="mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-2 text-left text-xs text-fg hover:bg-fg/10"
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
          <span className="truncate">{active ? displayName(active) : baseName(activePath)}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {shown.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">还没有项目</div>
        )}
        {shown.map(item)}
        <div className="my-1 border-t border-border" />
        <button
          data-testid="project-view-all"
          onClick={() => {
            setOpen(false)
            onOpenAllProjects()
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60"
        >
          <List className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />全部项目…
        </button>
        <button
          data-testid="project-add"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            onAdd()
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />添加项目…
        </button>
      </PopoverContent>
    </Popover>
  )
}
