// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ContextPanel from '../src/renderer/components/ContextPanel'
import type { ContextObservability, CompactionEntry } from '../src/shared/transcriptReducer'

afterEach(cleanup)

const baseCtx = (over: Partial<ContextObservability> = {}): ContextObservability => ({
  watermark: { usedTokens: 76800, window: 128000, ratio: 0.6, tier: 1, estimated: true },
  compactions: [],
  liveSummary: null,
  totalsFromSnapshot: { inputTokens: 5000, outputTokens: 200, cachedInputTokens: 1000, estimated: true },
  ...over,
})

const ENTRY: CompactionEntry = {
  ts: 1_700_000_000_000, tier: 2, beforeTokens: 10000, afterTokens: 4000,
  snipped: 3, pruned: 1, summarized: false, savedTokens: 6000,
  items: [{ index: 0, tool: 'grep_code', releasedEstTokens: 6000, logPath: '/tmp/sess/1-grep.log' }],
}

describe('ContextPanel render', () => {
  it('水位区:tier1 标签 + 60% 进度', () => {
    render(<ContextPanel context={baseCtx()} status={null} onCompact={() => {}} compactDisabled={false} />)
    expect(screen.getByText('上下文水位')).toBeTruthy()
    // tierOf(0.6)=1 → 「整理」;估算标注
    expect(screen.getByText(/整理/)).toBeTruthy()
    expect(screen.getByText(/60%/)).toBeTruthy()
  })

  it('未配价:显示价格提示,点「知道了」消失', () => {
    render(<ContextPanel context={baseCtx()} status={null} onCompact={() => {}} compactDisabled={false} />)
    const hint = screen.getByText(/未配置价格/)
    expect(hint).toBeTruthy()
    fireEvent.click(screen.getByText('知道了'))
    expect(screen.queryByText(/未配置价格/)).toBeNull()
  })

  it('压缩历史:空态文案 / 有条目时展开见 logPath', () => {
    const { rerender } = render(
      <ContextPanel context={baseCtx()} status={null} onCompact={() => {}} compactDisabled={false} />)
    expect(screen.getByText('本会话尚无压缩')).toBeTruthy()

    rerender(
      <ContextPanel context={baseCtx({ compactions: [ENTRY] })} status={null} onCompact={() => {}} compactDisabled={false} />)
    expect(screen.queryByText('本会话尚无压缩')).toBeNull()
    // 点开压缩条目(compactionLine 输出 "T2 snip×3 prune×1 …",T2 唯一)→ 见落盘 logPath(可回取证据)
    fireEvent.click(screen.getByText(/T2 snip/).closest('button')!)
    expect(screen.getByText(/1-grep\.log/)).toBeTruthy()
  })

  it('活摘要:有内容时渲染预览', () => {
    render(<ContextPanel context={baseCtx({ liveSummary: '【活摘要】前情提要 XYZ' })}
      status={null} onCompact={() => {}} compactDisabled={false} />)
    expect(screen.getByText(/前情提要 XYZ/)).toBeTruthy()
  })

  it('手动压缩按钮:disabled 守卫 + 点击回调', () => {
    const onCompact = vi.fn()
    const { rerender } = render(
      <ContextPanel context={baseCtx()} status={null} onCompact={onCompact} compactDisabled={true} />)
    const btn = screen.getByTestId('context-panel-compact') as HTMLButtonElement
    expect(btn.disabled).toBe(true)

    rerender(<ContextPanel context={baseCtx()} status={null} onCompact={onCompact} compactDisabled={false} />)
    const btn2 = screen.getByTestId('context-panel-compact') as HTMLButtonElement
    expect(btn2.disabled).toBe(false)
    fireEvent.click(btn2)
    expect(onCompact).toHaveBeenCalledTimes(1)
  })
})
