// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Transcript from '../src/renderer/components/Transcript'
import type { Item } from '../src/shared/transcriptReducer'

afterEach(() => cleanup())

const noop = () => {}
const base = {
  busy: false, onEditMessage: noop, onDeleteMessage: noop, onResendMessage: noop,
  onPlanReview: noop, mode: 'react' as const,
}

describe('Transcript —— action item', () => {
  it('渲染 action item 为 ActionCard,点击调 onOpenPanel', () => {
    const onOpenPanel = vi.fn()
    const items: Item[] = [{ type: 'action', panel: 'im-gateway' }]
    render(<Transcript {...base} items={items} onOpenPanel={onOpenPanel} />)
    fireEvent.click(screen.getByTestId('action-card'))
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })

  it('渲染 system-event item 为独立气泡,不混进用户消息', () => {
    const items: Item[] = [{ type: 'system-event', text: '微信绑定成功' }]
    render(<Transcript {...base} items={items} onOpenPanel={noop} />)
    expect(screen.getByTestId('system-event').textContent).toContain('微信绑定成功')
    // 不能被当成 user 气泡:user 气泡(且为最后一条)会挂出编辑/重发按钮,
    // 让用户去「重发」一条系统事件毫无意义。
    expect(screen.queryByTestId('msg-edit')).toBeNull()
    expect(screen.queryByTestId('msg-resend')).toBeNull()
  })
})
