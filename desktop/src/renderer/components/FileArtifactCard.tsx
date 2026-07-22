import { useState } from 'react'
import { ChevronDown, FileDiff, FilePlus, RotateCcw } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import { OpenWithMenu } from './OpenWithMenu'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

/**
 * 回复下方统一文件卡:新建/已编辑 + 查看更改/审核(→右侧 diff)+ 打开方式 + 撤销(文件级写回)。
 * before===null(仅 no-op 无 diff)→ 查看更改/审核/撤销 不渲染。撤销带 confirm,成功进「已撤销」态。
 */
export default function FileArtifactCard({ file, workspace, editors, onOpenPreview, onOpenDiff, onUndo }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onOpenPreview?: (filePath: string, content: string) => void
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  onUndo?: (file: ArtifactFile) => Promise<boolean>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [undone, setUndone] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const created = file.kind === 'created'
  const hasDiff = file.before !== null && !undone
  const doUndo = async (): Promise<void> => {
    if (!onUndo || file.before === null || pending) return
    const name = baseName(file.path)
    if (!window.confirm(created ? `删除新建的 ${name}?` : `把 ${name} 恢复到编辑前?`)) return
    setPending(true); setFailed(false)
    const ok = await onUndo(file)
    setPending(false)
    if (ok) setUndone(true); else setFailed(true)
  }
  return (
    <div data-testid="file-artifact-card" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      {created
        ? <FilePlus className="h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} />
        : <FileDiff className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />}
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <button data-testid="file-artifact-open-preview" onClick={() => onOpenPreview?.(file.path, file.content)}
          className="max-w-full truncate text-left text-sm font-medium text-fg" title={file.path}>
          {created ? '新建 ' : '已编辑 '}{baseName(file.path)}
        </button>
        {hasDiff && onOpenDiff && (
          <button data-testid="file-artifact-viewdiff" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
            className="text-2xs text-fg-subtle hover:text-accent">查看更改 ↗</button>
        )}
        {undone && <span data-testid="file-artifact-undone" className="text-2xs text-fg-subtle">已撤销</span>}
        {failed && <span data-testid="file-artifact-undo-failed" className="text-2xs text-danger">撤销失败</span>}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button data-testid="file-artifact-openwith"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">
            打开方式 <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52">
          <OpenWithMenu file={file} workspace={workspace} editors={editors} onAction={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {hasDiff && onOpenDiff && (
        <button data-testid="file-artifact-review" onClick={() => onOpenDiff(file.path, file.before ?? '', file.content)}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">审核</button>
      )}
      {hasDiff && onUndo && (
        <button data-testid="file-artifact-undo" onClick={() => void doUndo()} disabled={pending}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-danger hover:text-danger disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />撤销
        </button>
      )}
    </div>
  )
}
