/** 四档水位:阈值与后端 WatermarkGauge 一致(0.60/0.80/0.95),色值全端单一来源。 */
export function tierOf(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio >= 0.95) return 3
  if (ratio >= 0.8) return 2
  if (ratio >= 0.6) return 1
  return 0
}
export const TIER_HEX: Record<0 | 1 | 2 | 3, string> = { 0: '#22c55e', 1: '#eab308', 2: '#f97316', 3: '#ef4444' }
export const TIER_LABEL: Record<0 | 1 | 2 | 3, string> = { 0: '宽裕', 1: '整理', 2: '释压', 3: '兜底' }
export const TIER_TW: Record<0 | 1 | 2 | 3, string> = {
  0: 'text-emerald-500', 1: 'text-yellow-500', 2: 'text-orange-500', 3: 'text-red-500',
}
