import { useState } from 'react'
import { MoreHorizontal, Settings, Archive, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import type { ProjectRowData } from '../lib/projectsView'

export interface ProjectRowMenuProps {
  row: ProjectRowData
  /** 当前项目不可移出(移出会把工作目录抽走) */
  active: boolean
  onRename: (path: string, name: string) => void
  /** 只把意图交上去;数量提示与确认框在上层(App)弹,菜单不做破坏性确认 */
  onArchiveChats: (path: string, count: number) => void
  onRemove: (path: string) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  moveIndex?: number
  onMove?: (path: string, targetIndex: number) => void
}

export default function ProjectRowMenu({
  row, active, onRename, onArchiveChats, onRemove,
  canMoveUp = false, canMoveDown = false, moveIndex = 0, onMove,
}: ProjectRowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const { view, sessionCount } = row
  const path = view.path
  // 概况没回来(null)也禁用 —— 不知道数量就不该让用户点一个「归档 N 个」
  const canArchive = view.exists && sessionCount !== null && sessionCount > 0

  const startEdit = (): void => {
    setOpen(false)
    setDraft(view.name ?? '')
    setEditing(true)
  }

  const save = (): void => {
    setEditing(false)
    onRename(path, draft.trim())
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="project-row-menu"
            aria-label="更多"
            className="rounded p-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48">
          <button data-testid="project-menu-up" disabled={!canMoveUp} title="在当前分组内上移" onClick={() => onMove?.(path, moveIndex - 1)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 disabled:opacity-40">上移</button>
          <button data-testid="project-menu-down" disabled={!canMoveDown} title="在当前分组内下移" onClick={() => onMove?.(path, moveIndex + 1)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 disabled:opacity-40">下移</button>
          <div className="my-1 border-t border-border" />
          <button
            data-testid="project-menu-edit"
            onClick={startEdit}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 hover:text-fg"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />编辑项目
          </button>
          <button
            data-testid="project-menu-archive"
            disabled={!canArchive}
            title={canArchive ? '把这个项目的聊天全部归档' : '没有可归档的聊天'}
            onClick={() => {
              setOpen(false)
              onArchiveChats(path, sessionCount ?? 0)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            归档聊天{canArchive ? `（${sessionCount}）` : ''}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            data-testid="project-menu-remove"
            disabled={active}
            title={active ? '当前项目不可移出' : '移出列表(不删磁盘)'}
            onClick={() => {
              setOpen(false)
              onRemove(path)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />移除
          </button>
        </PopoverContent>
      </Popover>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent data-testid="project-edit-dialog" className="w-80">
          <DialogTitle>编辑项目</DialogTitle>
          <DialogDescription>别名只影响显示,不改磁盘上的目录名。</DialogDescription>
          <label className="mt-3 block text-3xs text-fg-subtle">别名</label>
          <input
            data-testid="project-edit-name"
            autoFocus
            value={draft}
            placeholder={row.displayName}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <label className="mt-3 block text-3xs text-fg-subtle">路径</label>
          <input
            data-testid="project-edit-path"
            readOnly
            value={path}
            onFocus={e => e.currentTarget.select()}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg-muted outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-muted hover:bg-fg/5"
            >
              取消
            </button>
            <button
              data-testid="project-edit-save"
              onClick={save}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
