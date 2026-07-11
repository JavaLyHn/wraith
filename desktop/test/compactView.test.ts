import { describe, it, expect } from 'vitest'
import { formatTokens, compactionNotice } from '../src/renderer/lib/compactView'

describe('formatTokens', () => {
  it('< 1000 原样', () => expect(formatTokens(980)).toBe('980'))
  it('千级', () => expect(formatTokens(1234)).toBe('1.2k'))
  it('整千去 .0', () => expect(formatTokens(4000)).toBe('4k'))
  it('百万级', () => expect(formatTokens(1_200_000)).toBe('1.2M'))
  it('0 / 负 → 0', () => { expect(formatTokens(0)).toBe('0'); expect(formatTokens(-5)).toBe('0') })
})

describe('compactionNotice', () => {
  it('成功显示前后 token', () =>
    expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 4100 }))
      .toBe('✅ 已整理上下文:12.3k → 4.1k tokens'))
  it('未压缩', () =>
    expect(compactionNotice({ compacted: false, beforeTokens: 500, afterTokens: 500 }))
      .toContain('无需整理'))
  it('失败优先', () =>
    expect(compactionNotice({ compacted: false, beforeTokens: 0, afterTokens: 0, error: 'X' }))
      .toBe('❌ 整理失败:X'))
})
