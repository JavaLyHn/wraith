import { useState } from 'react'
import { Columns2 } from 'lucide-react'
import ArtifactPreview from './ArtifactPreview'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'
import type { RightPreview } from '../../shared/artifactSummary'

function DiffPreview({ preview }: { preview: { filePath: string; before: string; after: string } }): JSX.Element {
  const [split, setSplit] = useState(false)
  return (
    <div data-testid="diff-preview" className="flex min-h-0 flex-1 flex-col animate-panel-in">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
        <span className="truncate font-mono font-semibold" title={preview.filePath}>{baseName(preview.filePath)}</span>
        <span className="shrink-0 text-2xs font-normal text-fg-subtle">· 更改</span>
        <button data-testid="diff-split-toggle" aria-pressed={split} onClick={() => setSplit(v => !v)}
          title={split ? '切回行内 diff' : '分两列显示(类 git)'}
          className={'ml-auto rounded p-1 ' + (split ? 'text-accent' : 'text-fg-subtle hover:text-fg')}>
          <Columns2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DiffView fill sideBySide={split} filePath={preview.filePath} before={preview.before} after={preview.after} />
      </div>
    </div>
  )
}

/** 右侧「预览」段:null→占位;content→完整内容;diff→只读 DiffView。 */
export default function PreviewPane({ preview }: { preview: RightPreview | null }): JSX.Element {
  if (preview == null) return <div className="p-3 text-xs text-fg-subtle">点击产物文件在此预览完整内容。</div>
  if (preview.kind === 'content') return <div className="flex min-h-0 flex-1 flex-col animate-panel-in"><ArtifactPreview filePath={preview.filePath} content={preview.content} /></div>
  return <DiffPreview key={preview.filePath} preview={preview} />
}
