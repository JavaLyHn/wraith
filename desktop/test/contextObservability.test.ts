import { describe, it, expect } from 'vitest'
import { reducer, initialState } from '../src/shared/transcriptReducer'
import { tierOf } from '../src/shared/contextTier'

const notif = (method: string, params: Record<string, unknown>) =>
  ({ kind: 'notification', method, params }) as never

describe('contextTier', () => {
  it('maps ratio to tier with backend thresholds', () => {
    expect(tierOf(0.2)).toBe(0)
    expect(tierOf(0.6)).toBe(1)
    expect(tierOf(0.8)).toBe(2)
    expect(tierOf(0.95)).toBe(3)
  })
})

describe('context observability slice', () => {
  it('watermark event overwrites and is authoritative', () => {
    let s = reducer(initialState, notif('context.watermark', { usedTokens: 60000, window: 100000, ratio: 0.6, tier: 1 }))
    expect(s.context.watermark).toEqual({ usedTokens: 60000, window: 100000, ratio: 0.6, tier: 1, estimated: false })
  })

  it('watermark event with estimated:true marks estimated (Plan/Team 收尾重发)', () => {
    const s = reducer(initialState, notif('context.watermark', { usedTokens: 56000, window: 128000, ratio: 0.44, tier: 0, estimated: true }))
    expect(s.context.watermark?.estimated).toBe(true)
    expect(s.context.watermark?.ratio).toBe(0.44)
  })

  it('compaction events append with cap 200', () => {
    let s = initialState
    for (let i = 0; i < 205; i++) {
      s = reducer(s, notif('context.compaction', {
        tier: 1, beforeTokens: 100, afterTokens: 50, snipped: 1, pruned: 0,
        summarized: false, savedTokens: 50,
      }))
    }
    expect(s.context.compactions.length).toBe(200)
  })

  it('compaction entry keeps fallback and manual flags', () => {
    const s = reducer(initialState, notif('context.compaction', {
      tier: 3, beforeTokens: 100, afterTokens: 90, snipped: 0, pruned: 2,
      summarized: false, fallback: 'emergency', manual: true, savedTokens: 10,
      items: [{ index: 2, tool: 'grep_code', releasedEstTokens: 5 }],
    }))
    const e = s.context.compactions[0]
    expect(e.fallback).toBe('emergency')
    expect(e.manual).toBe(true)
    expect(e.items?.[0].tool).toBe('grep_code')
  })

  it('snapshot initializes watermark(estimated)+liveSummary+totals', () => {
    const s = reducer(initialState, notif('context.snapshot', {
      usedTokens: 15000, contextWindow: 128000, ratio: 0.117, tier: 0, estimated: true,
      liveSummary: '进展:xxx', inputTokens: 18000, outputTokens: 200, cachedInputTokens: 9000,
      estimatedCost: '¥0.09',
    }))
    expect(s.context.watermark?.estimated).toBe(true)
    expect(s.context.watermark?.window).toBe(128000)
    expect(s.context.liveSummary).toBe('进展:xxx')
    expect(s.context.totalsFromSnapshot?.cachedInputTokens).toBe(9000)
  })

  it('real watermark event beats earlier estimated snapshot', () => {
    let s = reducer(initialState, notif('context.snapshot', { usedTokens: 1, contextWindow: 100, ratio: 0.01, tier: 0, estimated: true }))
    s = reducer(s, notif('context.watermark', { usedTokens: 60, window: 100, ratio: 0.6, tier: 1 }))
    expect(s.context.watermark?.estimated).toBe(false)
    expect(s.context.watermark?.ratio).toBe(0.6)
  })

  it('snapshot without watermark keys leaves watermark untouched (no fake 0%)', () => {
    let s = reducer(initialState, notif('context.watermark', { usedTokens: 60, window: 100, ratio: 0.6, tier: 1 }))
    s = reducer(s, notif('context.snapshot', { liveSummary: '摘要', inputTokens: 100, outputTokens: 1, cachedInputTokens: 0 }))
    expect(s.context.watermark?.ratio).toBe(0.6)
    expect(s.context.liveSummary).toBe('摘要')
    // 初始 null 也不被捏造
    const s2 = reducer(initialState, notif('context.snapshot', { liveSummary: null, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }))
    expect(s2.context.watermark).toBeNull()
  })

  it('snapshot restores compaction history from persisted metrics (重开应用后恢复)', () => {
    const s = reducer(initialState, notif('context.snapshot', {
      usedTokens: 40000, contextWindow: 128000, ratio: 0.31, tier: 0, estimated: false,
      compactions: [
        { ts: 111, tier: 1, beforeTokens: 9000, afterTokens: 6000, snipped: 3, pruned: 0, summarized: false, savedTokens: 3000, manual: false },
        { ts: 222, tier: 0, beforeTokens: 7000, afterTokens: 5000, snipped: 0, pruned: 2, summarized: true, savedTokens: 2000, manual: true },
      ],
    }))
    expect(s.context.compactions.length).toBe(2)
    expect(s.context.compactions[0].ts).toBe(111)          // 用持久化的真实时间,不是 Date.now()
    expect(s.context.compactions[1].manual).toBe(true)
    expect(s.context.compactions[1].summarized).toBe(true)
    expect(s.context.compactions[0].savedTokens).toBe(3000)
  })

  it('snapshot WITHOUT compactions key does not wipe live-accumulated history', () => {
    let s = reducer(initialState, notif('context.compaction', {
      tier: 1, beforeTokens: 100, afterTokens: 50, snipped: 1, pruned: 0, summarized: false, savedTokens: 50,
    }))
    // 一个不带 compactions 的快照(如 aggregator 没找到 JSONL)不应清掉 live 累积的历史
    s = reducer(s, notif('context.snapshot', { liveSummary: null, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }))
    expect(s.context.compactions.length).toBe(1)
  })

  it('context.reset clears the whole slice (session switch)', () => {
    let s = reducer(initialState, notif('context.compaction', {
      tier: 1, beforeTokens: 100, afterTokens: 50, snipped: 1, pruned: 0, summarized: false, savedTokens: 50,
    }))
    s = reducer(s, notif('context.watermark', { usedTokens: 60, window: 100, ratio: 0.6, tier: 1 }))
    s = reducer(s, notif('context.reset', {}))
    expect(s.context).toEqual({ watermark: null, compactions: [], liveSummary: null, totalsFromSnapshot: null })
  })
})
