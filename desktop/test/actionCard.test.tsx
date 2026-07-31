// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ActionCard from '../src/renderer/components/ActionCard'

afterEach(() => cleanup())

describe('ActionCard', () => {
  it('合法 panel 渲染中文名按钮,点击调 onOpenPanel(归一化 id)', () => {
    const onOpenPanel = vi.fn()
    render(<ActionCard panel="im-gateway" onOpenPanel={onOpenPanel} />)
    const btn = screen.getByTestId('action-card')
    expect(btn.textContent).toContain('IM 网关')
    fireEvent.click(btn)
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
  it('别名 mcp 归一到 plugins', () => {
    const onOpenPanel = vi.fn()
    render(<ActionCard panel="mcp" onOpenPanel={onOpenPanel} />)
    fireEvent.click(screen.getByTestId('action-card'))
    expect(onOpenPanel).toHaveBeenCalledWith('plugins')
  })
  it('非法 panel 渲染 null(无按钮)', () => {
    render(<ActionCard panel="nope" onOpenPanel={vi.fn()} />)
    expect(screen.queryByTestId('action-card')).toBeNull()
  })
})
