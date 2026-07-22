import { Download, FolderOpen } from 'lucide-react'
import { resolveWorkspacePath } from '../lib/paths'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60'

/** 「打开方式」菜单项(无 Radix,可直接单测)。各项走绝对路径调 window.wraith,点击后 onAction?.()。 */
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
      {editors.map((ed, i) => (
        <button key={ed.appPath} data-testid={`openwith-editor-${i}`} className={ITEM}
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
