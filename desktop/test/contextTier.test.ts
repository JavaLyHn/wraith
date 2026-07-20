import { describe, it, expect } from 'vitest'
import { tierOf, TIER_THRESHOLDS } from '../src/shared/contextTier'

// Phase D Task 4:tier 阈值单一来源。TS 侧镜像后端 WatermarkGauge.TIER1/2/3,此处锁死数值——
// 两端悄悄漂移即红(后端改阈值必须同步 contextTier.ts 的 TIER_THRESHOLDS)。
describe('contextTier 阈值一致性守卫', () => {
  it('阈值锁死为后端 WatermarkGauge 的 0.60/0.80/0.95', () => {
    expect(TIER_THRESHOLDS.tier1).toBe(0.6)
    expect(TIER_THRESHOLDS.tier2).toBe(0.8)
    expect(TIER_THRESHOLDS.tier3).toBe(0.95)
  })

  it('tierOf 边界与后端 tierOf 同口径', () => {
    expect(tierOf(0.599)).toBe(0)
    expect(tierOf(0.6)).toBe(1)
    expect(tierOf(0.799)).toBe(1)
    expect(tierOf(0.8)).toBe(2)
    expect(tierOf(0.949)).toBe(2)
    expect(tierOf(0.95)).toBe(3)
    expect(tierOf(1.5)).toBe(3)
  })

  it('tierOf 消费 TIER_THRESHOLDS(改常量即随动,不写死字面量)', () => {
    expect(tierOf(TIER_THRESHOLDS.tier1)).toBe(1)
    expect(tierOf(TIER_THRESHOLDS.tier2)).toBe(2)
    expect(tierOf(TIER_THRESHOLDS.tier3)).toBe(3)
  })
})
