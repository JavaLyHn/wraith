import { useState } from 'react'
import type { ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_HEX, TIER_LABEL } from '../../shared/contextTier'
import { formatTokens } from '../lib/compactView'
import { totalsView, compactionLine, compactionDetail, savedTotal, dotColor, relativeTime } from '../lib/contextPanelView'

/** 上下文治理面板(spec Phase C §3):水位/累计/压缩历史/活摘要预览/手动压缩。 */
export default function ContextPanel({ context, status, onCompact, compactDisabled }: {
  context: ContextObservability
  status: StatusData | null
  onCompact: () => void
  compactDisabled: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [pricingHintDismissed, setPricingHintDismissed] = useState(false)
  // 水位口径与 StatusChip 对齐:真实/快照 watermark 优先;缺席时回退到 status 估算(totalTokens/contextWindow),
  // 不再显示空白「暂无数据」——否则会出现底部 chip 显 40%、右侧面板却"暂无数据"的自相矛盾。
  const s = status && status.contextWindow > 0 ? status : null
  const w = context.watermark ?? (s
    ? { usedTokens: s.totalTokens, window: s.contextWindow, ratio: s.totalTokens / s.contextWindow, estimated: true }
    : null)
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
          <div key={i} className="mb-1.5">
            <button className="w-full rounded text-left hover:bg-surface/60"
              onClick={() => setExpanded(expanded === i ? null : i)}
              title={new Date(e.ts).toLocaleString()}>
              {/* 主行:圆点(档位色)+ 触发/档位/前后 + 相对时间 */}
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-fg-subtle">{expanded === i ? '▾' : '▸'}</span>
                <span className="shrink-0" style={{ color: dotColor(e.tier) }}>●</span>
                <span className="truncate font-medium">{compactionLine(e)}</span>
                <span className="ml-auto shrink-0 text-fg-subtle">{relativeTime(e.ts, Date.now())}</span>
              </div>
              {/* 副行:节省量 + 百分比 + 各遍分解 */}
              <div className="ml-6 text-2xs text-fg-muted">{compactionDetail(e)}</div>
            </button>
            {expanded === i && (
              e.items && e.items.length > 0
                ? <ul className="ml-6 mt-0.5 space-y-0.5 text-2xs text-fg-muted">
                    {e.items.map((it, j) => (
                      <li key={j} className="truncate" title={it.logPath ?? undefined}>
                        · {it.tool ?? 'user'} <span className="text-fg-subtle">释放 {formatTokens(it.releasedEstTokens)}</span>
                        {it.logPath ? <span className="text-fg-subtle"> · {it.logPath}</span> : ''}
                      </li>
                    ))}
                  </ul>
                : <div className="ml-6 mt-0.5 text-2xs text-fg-subtle">历史记录:无逐项明细(仅当次会话保留工具级明细)</div>
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
