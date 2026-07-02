import { useState } from 'react'
import DiffView from './DiffView'
import { baseName } from '../lib/paths'

interface DiffCardProps {
  filePath: string
  before: string
  after: string
}

/** write_file 事后 diff 卡片:折叠时卸载 DiffView(控内存),只留头部。 */
export default function DiffCard({ filePath, before, after }: DiffCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null)

  return (
    <div data-testid="diff-card" className="my-1 overflow-hidden rounded-xl border border-border bg-surface">
      <button
        data-testid="diff-card-toggle"
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-black/[0.02]"
      >
        <span className="font-mono font-semibold text-fg" title={filePath}>📝 {baseName(filePath)}</span>
        {stats && <span className="text-ok">+{stats.added}</span>}
        {stats && <span className="text-danger">-{stats.removed}</span>}
        <span className="ml-auto text-fg-subtle">{collapsed ? '展开' : '收起'}</span>
      </button>
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
