import { describe, it, expect } from 'vitest'
import { totalsView, compactionLine, savedTotal, dotColor } from '../src/renderer/lib/contextPanelView'
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

describe('compactionLine', () => {
  const base = { ts: 0, tier: 1, beforeTokens: 12300, afterTokens: 9000, snipped: 3, pruned: 0, summarized: false, savedTokens: 3300 }
  it('renders snip line', () => expect(compactionLine(base as never)).toBe('T1 snip×3 12.3k→9k'))
  it('renders summary line', () =>
    expect(compactionLine({ ...base, tier: 3, summarized: true } as never)).toBe('T3 摘要 12.3k→9k'))
  it('renders manual emergency line', () =>
    expect(compactionLine({ ...base, tier: 3, fallback: 'emergency', manual: true } as never)).toBe('手动 T3 兜底 12.3k→9k'))
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
