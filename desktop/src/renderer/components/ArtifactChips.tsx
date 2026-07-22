import { baseName } from '../lib/paths'
import type { ArtifactFile } from '../../shared/artifactSummary'

/**
 * agent 回复下方的「本回合产物」文件 chip 行。用与 AgentMessage 相同的两列布局
 * (w-6 占位 + gap-2.5)让 chip 与正文左对齐。点击在右侧「预览」pane 打开完整内容。
 */
export default function ArtifactChips({ files, onOpenArtifact }: {
  files: ArtifactFile[]
  onOpenArtifact: (filePath: string, content: string) => void
}): JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div data-testid="artifact-chips" className="flex gap-2.5">
      <div className="w-6 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {files.map(f => (
          <button
            key={f.path}
            data-testid="artifact-chip"
            title={f.path}
            onClick={() => onOpenArtifact(f.path, f.content)}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-2xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
          >
            <span aria-hidden>📄</span>
            <span className="max-w-[220px] truncate">{baseName(f.path)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
