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
})
