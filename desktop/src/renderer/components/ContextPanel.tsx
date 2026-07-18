import { useState } from 'react'
import type { ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_HEX, TIER_LABEL } from '../../shared/contextTier'
import { formatTokens } from '../lib/compactView'
import { totalsView, compactionLine, savedTotal, dotColor, relativeTime } from '../lib/contextPanelView'

/** 上下文治理面板(spec Phase C §3):水位/累计/压缩历史/活摘要预览/手动压缩。 */
export default function ContextPanel({ context, status, onCompact, compactDisabled }: {
  context: ContextObservability
  status: StatusData | null
  onCompact: () => void
  compactDisabled: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [pricingHintDismissed, setPricingHintDismissed] = useState(false)
  const w = context.watermark
  const tier = w ? tierOf(w.ratio) : 0
  const totals = totalsView(status, context.totalsFromSnapshot)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
      {/* 水位区 */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-medium">上下文水位</span>
          <span style={{ color: TIER_HEX[tier] }}>{TIER_LABEL[tier]}{w?.estimated ? '(估算)' : ''}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-border">
          <div className="h-full rounded" style={{
            width: `${w ? Math.min(100, Math.round(w.ratio * 100)) : 0}%`,
            backgroundColor: TIER_HEX[tier],
          }} />
        </div>
        <div className="mt-1 text-fg-muted">
          {w ? `${formatTokens(w.usedTokens)} / ${formatTokens(w.window)}(${Math.min(100, Math.round(w.ratio * 100))}%)` : '暂无数据'}
        </div>
      </div>
      {/* 累计区 */}
      <div className="grid grid-cols-2 gap-1 text-fg-muted">
        <span>累计节省</span><span>{formatTokens(savedTotal(context.compactions))} tokens(估算)</span>
        <span>cache 命中</span><span>{totals.hitRate}</span>
        <span>输入/输出</span><span>{formatTokens(totals.input)} / {formatTokens(totals.output)}</span>
        <span>成本</span><span>{totals.cost ?? '—'}</span>
      </div>
      {totals.cost === null && !pricingHintDismissed && (
        <div className="rounded border border-border p-2 text-fg-muted">
          该模型未配置价格,在 config.json 的 pricing 里加一条即可显示成本
          <button className="ml-2 underline" onClick={() => setPricingHintDismissed(true)}>知道了</button>
        </div>
      )}
      {/* 压缩历史 */}
      <div>
        <div className="mb-1 font-medium">压缩历史</div>
        {context.compactions.length === 0 && <div className="text-fg-muted">本会话尚无压缩</div>}
        {context.compactions.map((e, i) => (
          <div key={i}>
            <button className="w-full text-left hover:bg-surface/60"
              onClick={() => setExpanded(expanded === i ? null : i)}>
              <span style={{ color: dotColor(e.tier) }}>●</span>{' '}
              {compactionLine(e)}
              <span className="ml-1 text-fg-muted">{relativeTime(e.ts, Date.now())}</span>
            </button>
            {expanded === i && e.items && (
              <ul className="ml-4 text-fg-muted">
                {e.items.map((it, j) => (
                  <li key={j}>{it.tool ?? 'user'} −{formatTokens(it.releasedEstTokens)}{it.logPath ? ` · ${it.logPath}` : ''}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {/* 活摘要预览 */}
      <div>
        <div className="mb-1 font-medium">活摘要</div>
        {context.liveSummary
          ? <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border p-2 font-mono text-2xs">{context.liveSummary}</pre>
          : <div className="text-fg-muted">尚未生成活摘要</div>}
      </div>
      {/* 手动压缩 */}
      <button data-testid="context-panel-compact" onClick={onCompact} disabled={compactDisabled}
        className="rounded border border-border px-2 py-1 hover:bg-surface/60 disabled:cursor-not-allowed disabled:opacity-50">立即压缩</button>
    </div>
  )
}
