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
})
