// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import Transcript from '../src/renderer/components/Transcript'
import type { Item } from '../src/shared/transcriptReducer'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

// write_file 工具卡(ok!==false)经 filesUnderMessages 派生为产物 chip,挂到本轮最后一条 message 下。
// 不放 user 气泡:UserMessage 依赖 SettingsContext,与 hover peek 断言无关,这里只验产物卡渲染与 hover。
const items: Item[] = [
  { type: 'message', text: '已生成' },
  { type: 'tool', card: { callId: 'c1', name: 'write_file', argsJson: '{"path":"spec.md","content":"# x"}', output: '', done: true, ok: true } },
]

const baseProps = {
  busy: false,
  onEditMessage: vi.fn(),
  onDeleteMessage: vi.fn(),
  onResendMessage: vi.fn(),
  onPlanReview: vi.fn(),
  mode: 'react' as const,
  onOpenDiff: vi.fn(),
  onUndo: vi.fn(async () => ({ ok: true })),
  editors: [] as never[],
  workspace: '/proj',
  onOpenPanel: vi.fn(),
}

describe('Transcript 文件卡 hover peek', () => {
  it('渲染产物卡且支持 hover 预览', () => {
    const onOpenArtifact = vi.fn()
    render(<Transcript {...baseProps} items={items} onOpenArtifact={onOpenArtifact} />)
    const card = screen.getByTestId('file-artifact-card')
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('artifact-hover-popover')).toBeTruthy()
  })

  it('click 文件名仍触发 onOpenPreview(右侧 dock)', () => {
    const onOpenArtifact = vi.fn()
    render(<Transcript {...baseProps} items={items} onOpenArtifact={onOpenArtifact} />)
    fireEvent.click(screen.getByTestId('file-artifact-open-preview'))
    expect(onOpenArtifact).toHaveBeenCalledWith('spec.md', '# x')
  })
})
