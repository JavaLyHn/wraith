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
      .toBe('✅ 已压缩上下文:12.3k → 4.1k tokens'))
  it('未压缩', () =>
    expect(compactionNotice({ compacted: false, beforeTokens: 500, afterTokens: 500 }))
      .toContain('无需压缩'))
  it('失败优先', () =>
    expect(compactionNotice({ compacted: false, beforeTokens: 0, afterTokens: 0, error: 'X' }))
      .toBe('❌ 压缩失败:X'))
  it('summarized result mentions incremental summary', () =>
    expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 4100, summarized: true }))
      .toBe('✅ 已压缩上下文:12.3k → 4.1k tokens(含增量摘要)'))
  it('fallback result warns summary unavailable', () =>
    expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 9000, summarized: false, fallback: 'emergency' }))
      .toBe('⚠️ 摘要暂不可用,已零成本压缩:12.3k → 9k tokens'))
  it('plain compaction text unchanged', () =>
    expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 4100 }))
      .toBe('✅ 已压缩上下文:12.3k → 4.1k tokens'))
  it('zero-change fallback admits nothing was compressed', () =>
    expect(compactionNotice({ compacted: true, beforeTokens: 2000, afterTokens: 2000, summarized: false, fallback: 'emergency' }))
      .toBe('上下文暂无可压缩内容(摘要不可用,已尝试零成本手段)'))
})
