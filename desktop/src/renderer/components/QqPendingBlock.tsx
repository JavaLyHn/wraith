import { useState } from 'react'
import type { QqPendingItem } from '../../shared/types'
import { relativeTime } from '../lib/memoryView'
import { sortQqPending } from '../lib/qqPendingView'

/** QQ 待发队列区块:审批置顶提示去运行历史处理;结果项可单删;底部清空结果 + 被动回复提示。 */
export default function QqPendingBlock(
  { items, onRemove, onClearResults }:
  { items: QqPendingItem[]; onRemove: (id: string) => void; onClearResults: () => void },
): JSX.Element | null {
  const [clearConfirming, setClearConfirming] = useState(false)
  if (items.length === 0) return null
  const sorted = sortQqPending(items)
  const hasResults = sorted.some(i => i.kind === 'result')
  const now = Date.now()
  return (
    <div data-testid="qq-pending-block" className="mt-3 rounded-lg border border-border p-3">
      <div className="mb-2 text-xs font-medium text-fg">QQ 待发队列({items.length})</div>
      <ul className="space-y-1.5">
        {sorted.map((it, idx) => (
          <li key={it.id ?? `legacy-${idx}`} className="flex items-start gap-2 text-2xs">
            {it.kind === 'approval' ? (
              <>
                <span className="shrink-0">⚠️</span>
                <span className="min-w-0 flex-1 text-warn">
                  <span className="font-medium">{it.taskName}</span> 等待审批 —— 在「运行历史」中同意/拒绝
                </span>
              </>
            ) : (
              <>
                <span className="shrink-0">📋</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  <span className="font-medium text-fg">{it.taskName}</span> {it.answerPreview}
                </span>
              </>
            )}
            <span className="shrink-0 text-fg-subtle">{relativeTime(it.ts, now)}</span>
            {it.kind === 'result' && it.id && (
              <button data-testid="qq-pending-remove" title="删除这条待发结果"
                onClick={() => onRemove(it.id!)}
                className="shrink-0 text-fg-subtle hover:text-danger">×</button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-2xs text-fg-subtle">
        <span>QQ 仅支持被动回复:给机器人发任意一条消息,以上将自动送达</span>
        {hasResults && (
          clearConfirming ? (
            <span className="shrink-0">
              确认?
              <button data-testid="qq-pending-clear-confirm" className="ml-1 text-danger"
                onClick={() => { setClearConfirming(false); onClearResults() }}>清空</button>
              <button className="ml-1" onClick={() => setClearConfirming(false)}>取消</button>
            </span>
          ) : (
            <button data-testid="qq-pending-clear" className="shrink-0 hover:text-danger"
              onClick={() => setClearConfirming(true)}>清空结果</button>
          )
        )}
      </div>
    </div>
  )
}
