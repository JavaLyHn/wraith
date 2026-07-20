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

/** 主行:触发方式 + 档位 + 前后 token(概览)。 */
export function compactionLine(e: CompactionEntry): string {
  const trigger = e.manual ? '手动' : '自动'
  return `${trigger} · T${e.tier} · ${formatTokens(e.beforeTokens)}→${formatTokens(e.afterTokens)}`
}

/** 副行(明细):节省量 + 百分比 + 各遍分解;零变更如实说明"无可压缩"。 */
export function compactionDetail(e: CompactionEntry): string {
  const saved = Math.max(0, e.savedTokens)
  const passes: string[] = []
  if (e.snipped > 0) passes.push(`截断×${e.snipped}`)
  if (e.pruned > 0) passes.push(`裁剪×${e.pruned}`)
  if (e.summarized) passes.push('增量摘要')
  if (e.fallback === 'emergency') passes.push('紧急兜底')
  if (e.fallback === 'cooldown') passes.push('冷却兜底')
  if (saved <= 0 && passes.length === 0) return '无可压缩内容(均在保护范围内)'
  const pct = e.beforeTokens > 0 ? Math.round((saved / e.beforeTokens) * 100) : 0
  const savedStr = saved > 0 ? `省 ${formatTokens(saved)} (−${pct}%)` : '无净变化'
  return passes.length ? `${savedStr} · ${passes.join(' · ')}` : savedStr
}

export function savedTotal(compactions: CompactionEntry[]): number {
  return compactions.reduce((a, e) => a + Math.max(0, e.savedTokens), 0)
}

/** 相对时间:<60s "刚刚",<60m "N 分钟前",其余 "N 小时前"。 */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  return `${Math.floor(s / 3600)} 小时前`
}

/** 压缩历史行的圆点色:合法 tier(0-3)取对应档位色,越界/非数字诚实回退中性灰(不伪装成 tier0 宽裕绿)。 */
export function dotColor(tier: number): string {
  const known = Number.isFinite(tier) && tier >= 0 && tier <= 3
  return known ? TIER_HEX[Math.trunc(tier) as 0 | 1 | 2 | 3] : TIER_UNKNOWN_HEX
}
