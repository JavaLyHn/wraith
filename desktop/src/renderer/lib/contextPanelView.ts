import { formatTokens } from './compactView'
import type { CompactionEntry, ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'

export function totalsView(
  status: StatusData | null,
  snap: ContextObservability['totalsFromSnapshot'],
): { input: number; output: number; cached: number; cost: string | null; hitRate: string } {
  const live = status && (status.inputTokens > 0 || status.totalTokens > 0)
  const input = live ? status.inputTokens : snap?.inputTokens ?? 0
  const output = live ? status.outputTokens : snap?.outputTokens ?? 0
  const cached = live ? status.cachedInputTokens : snap?.cachedInputTokens ?? 0
  const cost = live ? status.estimatedCost ?? snap?.estimatedCost ?? null : snap?.estimatedCost ?? null
  const hitRate = input > 0 ? Math.round((cached / input) * 100) + '%' : '—'
  return { input, output, cached, cost, hitRate }
}

export function compactionLine(e: CompactionEntry): string {
  const action = e.summarized ? '摘要'
    : e.fallback === 'emergency' ? '兜底'
    : e.fallback === 'cooldown' ? '冷却'
    : `snip×${e.snipped}${e.pruned ? ` prune×${e.pruned}` : ''}`
  const prefix = e.manual ? '手动 ' : ''
  return `${prefix}T${e.tier} ${action} ${formatTokens(e.beforeTokens)}→${formatTokens(e.afterTokens)}`
}

export function savedTotal(compactions: CompactionEntry[]): number {
  return compactions.reduce((a, e) => a + Math.max(0, e.savedTokens), 0)
}
