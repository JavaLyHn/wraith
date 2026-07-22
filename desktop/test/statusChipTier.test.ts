import { describe, it, expect } from 'vitest'
import { chipView } from '../src/renderer/components/StatusChip'

describe('chipView', () => {
  const status = { totalTokens: 30000, contextWindow: 100000 } as never
  it('prefers real watermark ratio over estimate', () => {
    const v = chipView(status, { ratio: 0.62, tier: 2, estimated: false })
    expect(v.pct).toBe(62)
    expect(v.tw).toBe('text-orange-500')
    expect(v.suffix).toBe('')
  })
  it('estimated watermark carries tilde', () => {
    expect(chipView(status, { ratio: 0.62, tier: 2, estimated: true }).suffix).toBe('~')
  })
  it('falls back to status estimate with tilde', () => {
    const v = chipView(status, null)
    expect(v.pct).toBe(30)
    expect(v.suffix).toBe('~')
    expect(v.tw).toBe('text-green-500')
  })
  it('out-of-range tier falls back to tierOf(ratio)', () => {
    const v = chipView(status, { ratio: 0.62, tier: 5, estimated: false })
    expect(v.tw).toBe('text-yellow-500') // tierOf(0.62)=1
  })
  it('negative ratio clamps pct to 0', () => {
    expect(chipView(status, { ratio: -0.5, tier: 0, estimated: false }).pct).toBe(0)
  })
  it('null status + watermark:仍按 watermark 出数(Plan/Team 无 status)', () => {
    const v = chipView(null, { ratio: 0.09, tier: 0, estimated: false })
    expect(v.pct).toBe(9)
    expect(v.suffix).toBe('')
  })
  it('null status + no watermark:回退 0%(不崩)', () => {
    expect(chipView(null, null).pct).toBe(0)
  })
  it('首轮前:无 status + 估算基线 → 0%(新会话不显基线占用)', () => {
    const v = chipView(null, { ratio: 0.03, tier: 0, estimated: true })
    expect(v.pct).toBe(0)
    expect(v.suffix).toBe('')
  })
})
