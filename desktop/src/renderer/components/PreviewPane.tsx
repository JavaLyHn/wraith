import ArtifactPreview from './ArtifactPreview'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'
import type { RightPreview } from '../../shared/artifactSummary'

/** 右侧「预览」段:null→占位;content→完整内容;diff→只读 DiffView。 */
export default function PreviewPane({ preview }: { preview: RightPreview | null }): JSX.Element {
  if (preview == null) return <div className="p-3 text-xs text-fg-subtle">点击产物文件在此预览完整内容。</div>
  if (preview.kind === 'content') return <ArtifactPreview filePath={preview.filePath} content={preview.content} />
  return (
    <div data-testid="diff-preview" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
        <span className="truncate font-mono font-semibold" title={preview.filePath}>{baseName(preview.filePath)}</span>
        <span className="shrink-0 text-2xs font-normal text-fg-subtle">· 更改</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <DiffView filePath={preview.filePath} before={preview.before} after={preview.after} />
      </div>
    </div>
  )
}
