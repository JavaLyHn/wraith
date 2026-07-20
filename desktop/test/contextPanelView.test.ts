import { describe, it, expect } from 'vitest'
import { totalsView, compactionLine, compactionDetail, savedTotal, dotColor, relativeTime } from '../src/renderer/lib/contextPanelView'
import { TIER_HEX } from '../src/shared/contextTier'

describe('totalsView', () => {
  it('prefers live status over snapshot', () => {
    const v = totalsView(
      { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 400, estimatedCost: '¥0.10', totalTokens: 1, contextWindow: 1 } as never,
      { inputTokens: 9, outputTokens: 9, cachedInputTokens: 9, estimated: true },
    )
    expect(v.input).toBe(1000)
    expect(v.hitRate).toBe('40%')
    expect(v.cost).toBe('¥0.10')
  })
  it('falls back to snapshot when status empty', () => {
    const v = totalsView(
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: null, totalTokens: 0, contextWindow: 1 } as never,
      { inputTokens: 500, outputTokens: 5, cachedInputTokens: 100, estimatedCost: '¥0.05', estimated: false },
    )
    expect(v.input).toBe(500)
    expect(v.hitRate).toBe('20%')
    expect(v.cost).toBe('¥0.05')
  })
  it('zero denominator yields em-dash and null cost stays null', () => {
    const v = totalsView({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: null, totalTokens: 0, contextWindow: 1 } as never, null)
    expect(v.hitRate).toBe('—')
    expect(v.cost).toBeNull()
  })
})

describe('compactionLine (主行:触发/档位/前后)', () => {
  const base = { ts: 0, tier: 1, beforeTokens: 12300, afterTokens: 9000, snipped: 3, pruned: 0, summarized: false, savedTokens: 3300 }
  it('自动', () => expect(compactionLine(base as never)).toBe('自动 · T1 · 12.3k→9k'))
  it('手动', () => expect(compactionLine({ ...base, manual: true } as never)).toBe('手动 · T1 · 12.3k→9k'))
  it('档位随 tier', () =>
    expect(compactionLine({ ...base, tier: 3 } as never)).toBe('自动 · T3 · 12.3k→9k'))
})

describe('compactionDetail (副行:节省+百分比+各遍分解)', () => {
  const base = { ts: 0, tier: 1, beforeTokens: 12300, afterTokens: 9000, snipped: 3, pruned: 0, summarized: false, savedTokens: 3300 }
  it('截断:省量+百分比', () =>
    expect(compactionDetail(base as never)).toBe('省 3.3k (−27%) · 截断×3'))
  it('截断+裁剪+摘要 全列出', () =>
    expect(compactionDetail({ ...base, pruned: 1, summarized: true } as never))
      .toBe('省 3.3k (−27%) · 截断×3 · 裁剪×1 · 增量摘要'))
  it('紧急兜底', () =>
    expect(compactionDetail({ ...base, fallback: 'emergency' } as never))
      .toBe('省 3.3k (−27%) · 截断×3 · 紧急兜底'))
  it('零变更如实说明无可压缩', () =>
    expect(compactionDetail({ ...base, snipped: 0, pruned: 0, savedTokens: 0, afterTokens: 12300 } as never))
      .toBe('无可压缩内容(均在保护范围内)'))
})

describe('savedTotal', () => {
  it('sums savedTokens', () =>
    expect(savedTotal([{ savedTokens: 10 }, { savedTokens: 5 }] as never)).toBe(15))
})

describe('dotColor', () => {
  it('returns the tier color for a legal tier', () => {
    expect(dotColor(2)).toBe(TIER_HEX[2])
  })
  it('falls back to neutral gray for an out-of-range tier (never fakes tier0 green)', () => {
    expect(dotColor(4)).toBe('#9ca3af')
    expect(dotColor(-1)).toBe('#9ca3af')
    expect(dotColor(NaN)).toBe('#9ca3af')
  })
})

describe('relativeTime', () => {
  it('under 60s renders 刚刚', () => {
    expect(relativeTime(1000, 1000)).toBe('刚刚')
    expect(relativeTime(1000, 1000 + 59_000)).toBe('刚刚')
  })
  it('60s boundary renders 分钟前', () => {
    expect(relativeTime(0, 60_000)).toBe('1 分钟前')
    expect(relativeTime(0, 5 * 60_000)).toBe('5 分钟前')
  })
  it('60min boundary renders 小时前', () => {
    expect(relativeTime(0, 3600_000)).toBe('1 小时前')
  })
})
