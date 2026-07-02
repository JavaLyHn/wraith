import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import type { ProjectView } from '../../shared/types'

interface ProjectSwitcherProps {
  projects: ProjectView[]
  /** 当前活跃项目路径(= state.workspace)。 */
  activePath: string
  /** turn 运行中:禁激活/添加;重命名与移出不受限(纯 settings 操作)。 */
  busy: boolean
  onActivate: (path: string) => void
  onAdd: () => void
  onRemove: (path: string) => void
  onRename: (path: string, name: string) => void
}

export default function ProjectSwitcher({
  projects,
  activePath,
  busy,
  onActivate,
  onAdd,
  onRemove,
  onRename,
}: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const displayName = (p: ProjectView): string => p.name || baseName(p.path)
  const active = projects.find(p => p.path === activePath)

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o)
        if (!o) setRenaming(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          data-testid="project-switcher"
          title={activePath || '默认工作目录'}
          className="mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent"
        >
          <span className="truncate">📁 {active ? displayName(active) : baseName(activePath)}</span>
          <span className="ml-auto shrink-0 text-fg-subtle">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {projects.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">还没有项目</div>
        )}
        {projects.map(p =>
          renaming === p.path ? (
            <input
              key={p.path}
              data-testid="project-rename-input"
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setRenaming(null)
                  onRename(p.path, draft)
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              className="mb-0.5 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
            />
          ) : (
            <div key={p.path} className="group mb-0.5 flex items-center gap-1">
              <button
                data-testid="project-item"
                disabled={busy || !p.exists}
                title={p.exists ? p.path : '目录不存在'}
                onClick={() => {
                  setOpen(false)
                  if (p.path !== activePath) onActivate(p.path) // 点当前项目=只收面板
                }}
                className={
                  'flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-60 ' +
                  (p.path === activePath
                    ? 'bg-surface text-fg'
                    : 'text-fg-muted enabled:hover:bg-surface/60')
                }
              >
                {displayName(p)}
                {p.path === activePath ? ' ✓' : ''}
              </button>
              <button
                data-testid="project-rename"
                title="重命名"
                onClick={() => {
                  setRenaming(p.path)
                  setDraft(p.name ?? '')
                }}
                className="hidden shrink-0 rounded p-1 text-xs text-fg-subtle hover:text-accent group-hover:block"
              >
                ✎
              </button>
              <button
                data-testid="project-remove"
                title={p.path === activePath ? '当前项目不可移出' : '移出列表(不删磁盘)'}
                disabled={p.path === activePath}
                onClick={() => onRemove(p.path)}
                className="hidden shrink-0 rounded p-1 text-xs text-fg-subtle hover:text-danger disabled:opacity-40 group-hover:block"
              >
                ✕
              </button>
            </div>
          ),
        )}
        <div className="my-1 border-t border-border" />
        <button
          data-testid="project-add"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            onAdd()
          }}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60"
        >
          ＋ 添加项目…
        </button>
      </PopoverContent>
    </Popover>
  )
}
