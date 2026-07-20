/**
 * 四档水位阈值。⚠ 单一来源在后端 `WatermarkGauge.TIER1/2/3`(Java)——渲染层跨语言无法直接引用,
 * 故在此镜像一份具名常量并锁死数值:改后端阈值时**必须同步这里**(contextTier.test 断言这三个值,
 * 越界即红,防两端悄悄漂移)。tier 判定逻辑与后端 `WatermarkGauge.tierOf` 等价。
 */
export const TIER_THRESHOLDS = { tier1: 0.6, tier2: 0.8, tier3: 0.95 } as const

/** ratio → 档位 0..3(与后端 WatermarkGauge.tierOf 同口径)。 */
export function tierOf(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio >= TIER_THRESHOLDS.tier3) return 3
  if (ratio >= TIER_THRESHOLDS.tier2) return 2
  if (ratio >= TIER_THRESHOLDS.tier1) return 1
  return 0
}
export const TIER_HEX: Record<0 | 1 | 2 | 3, string> = { 0: '#22c55e', 1: '#eab308', 2: '#f97316', 3: '#ef4444' }
export const TIER_LABEL: Record<0 | 1 | 2 | 3, string> = { 0: '宽裕', 1: '整理', 2: '释压', 3: '兜底' }
export const TIER_TW: Record<0 | 1 | 2 | 3, string> = {
  0: 'text-green-500', 1: 'text-yellow-500', 2: 'text-orange-500', 3: 'text-red-500',
}
