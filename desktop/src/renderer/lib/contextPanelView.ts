import { formatTokens } from './compactView'
import { TIER_HEX } from '../../shared/contextTier'
import type { CompactionEntry, ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'

/** 中性灰:tier 越界/非法(CompactionEntry 无 ratio 可回退,不能伪装成"宽裕"绿)。 */
const TIER_UNKNOWN_HEX = '#9ca3af'

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

/** 压缩历史行的圆点色:合法 tier(0-3)取对应档位色,越界/非数字诚实回退中性灰(不伪装成 tier0 宽裕绿)。 */
export function dotColor(tier: number): string {
  const known = Number.isFinite(tier) && tier >= 0 && tier <= 3
  return known ? TIER_HEX[Math.trunc(tier) as 0 | 1 | 2 | 3] : TIER_UNKNOWN_HEX
}
