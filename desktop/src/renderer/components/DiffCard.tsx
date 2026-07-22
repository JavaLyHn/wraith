import { useState } from 'react'
import { PanelRight } from 'lucide-react'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'

interface DiffCardProps {
  filePath: string
  before: string
  after: string
  /** 提供时,卡片头部出现「在右侧打开」按钮,点击把完整内容开到右侧预览 pane。 */
  onOpenArtifact?: (filePath: string, content: string) => void
}

/** write_file 事后 diff 卡片:折叠时卸载 DiffView(控内存)。可选「在右侧打开」入口渲染完整内容。 */
export default function DiffCard({ filePath, before, after, onOpenArtifact }: DiffCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null)

  return (
    <div data-testid="diff-card" className="my-1 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-xs">
        <button
          data-testid="diff-card-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          <span className="truncate font-mono font-semibold text-fg" title={filePath}>📝 {baseName(filePath)}</span>
          {stats && <span className="shrink-0 text-ok">+{stats.added}</span>}
          {stats && <span className="shrink-0 text-danger">-{stats.removed}</span>}
        </button>
        {onOpenArtifact && (
          <button
            data-testid="diff-card-open"
            title="在右侧打开完整内容"
            onClick={() => onOpenArtifact(filePath, after)}
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-fg/10 hover:text-fg"
          >
            <PanelRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          data-testid="diff-card-toggle-label"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-fg-subtle hover:text-fg"
        >{collapsed ? '展开' : '收起'}</button>
      </div>
      {!collapsed && (
        <DiffView
          filePath={filePath}
          before={before}
          after={after}
          onStats={(added, removed) => setStats({ added, removed })}
        />
      )}
    </div>
  )
}
