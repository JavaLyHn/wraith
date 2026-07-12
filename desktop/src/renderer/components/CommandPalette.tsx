import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { buildStaticItems, filterPalette, type PaletteItem } from '../lib/commandPalette'
import type { SessionFilterItem } from '../lib/sidebarSearch'
import type { ProjectView } from '../../shared/types'

export interface PaletteActions {
  selectSession: (id: string) => void
  activateProject: (path: string) => void
  newConversation: () => void
  openSettings: () => void
  openView: (view: string) => void
}

/** 居中命令面板:搜索会话/项目 + 命令 + 导航。⌘K 开(由 App);面板内 ↑↓/回车/⌘1–9/Esc/点遮罩。 */
export default function CommandPalette(
  { open, onClose, sessions, projects, actions }:
  { open: boolean; onClose: () => void; sessions: SessionFilterItem[]; projects: ProjectView[]; actions: PaletteActions },
): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const staticItems = useMemo(() => buildStaticItems(), [])
  const { groups, flat } = useMemo(
    () => filterPalette(query, sessions, projects, staticItems),
    [query, sessions, projects, staticItems],
  )

  useEffect(() => { if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()) } }, [open])
  useEffect(() => { setActive(0) }, [query])

  const run = (item: PaletteItem): void => {
    const a = item.action
    if (a.startsWith('session:')) actions.selectSession(a.slice(8))
    else if (a.startsWith('project:')) actions.activateProject(a.slice(8))
    else if (a === 'new') actions.newConversation()
    else if (a === 'settings') actions.openSettings()
    else if (a.startsWith('view:')) actions.openView(a.slice(5))
    onClose()
  }

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }   // 阻止冒泡到 app 级 Esc(避免连带中断运行中的对话)
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(flat.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = flat[active]; if (it) run(it) }
    else if (e.metaKey && e.key >= '1' && e.key <= '9') { const idx = Number(e.key) - 1; if (idx < flat.length) { e.preventDefault(); run(flat[idx]!) } }
  }

  let counter = -1
  return (
    <div data-testid="command-palette" onMouseDown={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[12vh]">
      <div onMouseDown={e => e.stopPropagation()} onKeyDown={onKeyDown}
        className="flex max-h-[68vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
          <input ref={inputRef} data-testid="palette-input" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="搜索任务或运行命令"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {flat.length === 0 && <div className="px-4 py-6 text-center text-xs text-fg-subtle">无匹配结果</div>}
          {groups.map(g => (
            <div key={g.title} className="mb-1">
              <div className="px-4 py-1 text-2xs font-medium text-fg-subtle">{g.title}</div>
              {g.items.map(item => {
                counter += 1
                const idx = counter
                const sel = idx === active
                const numHint = idx < 9 ? '⌘' + (idx + 1) : ''
                return (
                  <button key={item.id} data-testid="palette-item"
                    onMouseEnter={() => setActive(idx)} onClick={() => run(item)}
                    className={'flex w-full items-center gap-2 px-4 py-2 text-left text-sm '
                      + (sel ? 'bg-accent/12 text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 text-2xs text-fg-subtle">{item.hint || numHint}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
