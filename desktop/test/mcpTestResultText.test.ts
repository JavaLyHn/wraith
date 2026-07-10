import { describe, it, expect } from 'vitest'
import { formatMcpTestResult } from '../src/renderer/lib/mcpTestResultText'

describe('formatMcpTestResult', () => {
  it('成功 → 绿文案含工具数与耗时', () => {
    expect(formatMcpTestResult({ ok: true, toolCount: 12, latencyMs: 843 }))
      .toEqual({ kind: 'ok', text: '✅ 连接成功 · 12 个工具 · 843ms' })
  })
  it('成功但字段缺省 → 兜底 0', () => {
    expect(formatMcpTestResult({ ok: true }))
      .toEqual({ kind: 'ok', text: '✅ 连接成功 · 0 个工具 · 0ms' })
  })
  it('失败 → 红文案含错误', () => {
    expect(formatMcpTestResult({ ok: false, error: 'ENOENT: npx not found' }))
      .toEqual({ kind: 'err', text: '❌ 连接失败:ENOENT: npx not found' })
  })
  it('失败但 error 缺省 → 未知错误', () => {
    expect(formatMcpTestResult({ ok: false }))
      .toEqual({ kind: 'err', text: '❌ 连接失败:未知错误' })
  })
})
