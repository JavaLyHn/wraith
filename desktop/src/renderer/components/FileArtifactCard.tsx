import { useState } from 'react'
import { ChevronDown, FileDiff, FilePlus, RotateCcw, X, XCircle } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName } from '../lib/paths'
import { OpenWithMenu } from './OpenWithMenu'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

/**
 * 回复下方统一文件卡:新建/已编辑 + 查看更改/审核(→右侧 diff)+ 打开方式 + 撤销(文件级写回)。
 * before===null(仅 no-op 无 diff)→ 查看更改/审核/撤销 不渲染。撤销带 confirm,成功进「已撤销」终态
 *(此后隐藏打开方式等一切动作:文件已写回/删除,再操作无意义或必失败)。失败弹窗显示真实原因。
 */
export default function FileArtifactCard({ file, workspace, editors, onOpenPreview, onOpenDiff, onUndo }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onOpenPreview?: (filePath: string, content: string) => void
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  onUndo?: (file: ArtifactFile) => Promise<{ ok: boolean; message?: string }>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [undone, setUndone] = useState(false)
  const [pending, setPending] = useState(false)
  const [failMsg, setFailMsg] = useState<string | null>(null)
  const created = file.kind === 'created'
  const hasDiff = file.before !== null && !undone
  const doUndo = async (): Promise<void> => {
    if (!onUndo || file.before === null || pending) return
    const name = baseName(file.path)
    if (!window.confirm(created ? `删除新建的 ${name}?` : `把 ${name} 恢复到编辑前?`)) return
    setPending(true); setFailMsg(null)
    const r = await onUndo(file)
    setPending(false)
    if (r.ok) setUndone(true); else setFailMsg(r.message || '未知错误')
  }
  return (
    <>
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
        </div>
        {!undone && (
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
        )}
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
      {failMsg !== null && (
        <div data-testid="file-artifact-undo-failed" role="alertdialog" aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFailMsg(null)}>
          <div className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <XCircle className="h-5 w-5" strokeWidth={2} />
              </span>
              <button data-testid="undo-failed-x" onClick={() => setFailMsg(null)}
                className="rounded p-1 text-fg-subtle hover:bg-fg/10 hover:text-fg"><X className="h-4 w-4" strokeWidth={1.5} /></button>
            </div>
            <div className="mb-1 text-lg font-bold text-fg">撤销失败</div>
            <div className="mb-5 text-sm text-fg-muted">{failMsg}</div>
            <button data-testid="undo-failed-close" onClick={() => setFailMsg(null)}
              className="w-full rounded-xl bg-fg py-2.5 text-sm font-semibold text-bg hover:opacity-90">关闭</button>
          </div>
        </div>
      )}
    </>
  )
}
