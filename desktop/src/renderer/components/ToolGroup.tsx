import { useState } from 'react'
import type { ToolCard as ToolCardType } from '../../shared/transcriptReducer'
import { toolCardFailed } from '../../shared/toolBadge'
import ToolCard from './ToolCard'

interface ToolGroupProps {
  cards: ToolCardType[]
}

/**
 * 可折叠「工作过程」区块：将连续工具卡片组合为单行摘要。
 * 默认折叠，显示 "⚙ 工作过程 · N 步"，若有失败项附红色提示。
 * 点击展开后渲染各 ToolCard（各自也默认折叠，仅失败展开）。
 */
export default function ToolGroup({ cards }: ToolGroupProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const hasFailed = cards.some(toolCardFailed)
  const count = cards.length

  return (
    <div
      data-testid="tool-group"
      className="my-1 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      {/* 折叠头部 */}
      <button
        type="button"
        data-testid="tool-group-header"
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
        className={
          'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-fg/[0.03] ' +
          (expanded ? 'border-b border-border' : '')
        }
      >
        <span className="shrink-0 text-fg-subtle">{expanded ? '▾' : '▸'}</span>
        <span className="text-fg-muted">⚙ 工作过程</span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted">{count} 步</span>
        {hasFailed && (
          <span className="ml-1 text-danger text-2xs font-semibold">有失败</span>
        )}
      </button>

      {/* 展开内容：各工具卡片（各自默认折叠） */}
      {expanded && (
        <div className="flex flex-col gap-0 px-2 py-1">
          {cards.map(card => (
            <ToolCard key={card.callId} card={card} />
          ))}
        </div>
      )}
    </div>
  )
}
