import { useState } from 'react'
import { ChevronDown, Download, FileText, FolderOpen } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { baseName, resolveWorkspacePath } from '../lib/paths'
import { fileTypeLabel } from '../lib/fileType'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60'

/**
 * 「打开方式」菜单项列表(不含 Radix,可直接渲染单测)。各项走绝对路径调 window.wraith 的 IPC;
 * 点击后调 onAction?.()(供外层关 popover)。editors 为空时只剩固定项。
 */
export function OpenWithMenu({ file, workspace, editors, onAction }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onAction?: () => void
}): JSX.Element {
  const abs = resolveWorkspacePath(file.path, workspace)
  const run = (fn: () => Promise<unknown>): void => { onAction?.(); void fn().catch(() => {}) }
  return (
    <>
      <button data-testid="openwith-default" className={ITEM} onClick={() => run(() => window.wraith.openPath(abs))}>默认程序</button>
      {editors.map(ed => (
        <button key={ed.appPath} data-testid="openwith-editor" className={ITEM}
          onClick={() => run(() => window.wraith.openWithApp(abs, ed.appPath))}>{ed.name}</button>
      ))}
      <div className="my-1 border-t border-border/60" />
      <button data-testid="openwith-reveal" className={ITEM} onClick={() => run(() => window.wraith.revealInFinder(abs))}>
        <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />在 Finder 中显示
      </button>
      <button data-testid="openwith-download" className={ITEM} onClick={() => run(() => window.wraith.downloadCopy(abs))}>
        <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />下载副本
      </button>
    </>
  )
}

/**
 * 回复下方的文件产物卡:文件名 + 类型标签 + 「打开方式」下拉(Radix popover 包 OpenWithMenu)。
 * 点卡体 → 右侧内容预览(onOpenPreview,in-app,用原 path+content)。
 */
export default function FileArtifactCard({ file, workspace, editors, onOpenPreview }: {
  file: ArtifactFile
  workspace: string | null
  editors: EditorApp[]
  onOpenPreview: (filePath: string, content: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="file-artifact-card" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
      <button
        data-testid="file-artifact-open-preview"
        onClick={() => onOpenPreview(file.path, file.content)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="max-w-full truncate text-sm font-medium text-fg" title={file.path}>{baseName(file.path)}</span>
        <span className="text-2xs text-fg-subtle">{fileTypeLabel(file.path)}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="file-artifact-openwith"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent"
          >打开方式 <ChevronDown className="h-3 w-3" strokeWidth={1.5} /></button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52">
          <OpenWithMenu file={file} workspace={workspace} editors={editors} onAction={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
