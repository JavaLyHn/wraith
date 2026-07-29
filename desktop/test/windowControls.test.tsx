// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import WindowControls from '../src/renderer/components/WindowControls'

afterEach(cleanup)

function mockWc(): { minimize: ReturnType<typeof vi.fn>; toggleMaximize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; emit: (m: boolean) => void } {
  const listeners: Array<(m: boolean) => void> = []
  const wc = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(async () => false),
    onMaximizeChange: vi.fn((cb: (m: boolean) => void) => { listeners.push(cb); return () => {} }),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = { platform: 'win32', windowControls: wc }
  return { minimize: wc.minimize, toggleMaximize: wc.toggleMaximize, close: wc.close, emit: (m) => listeners.forEach(l => l(m)) }
}

describe('WindowControls', () => {
  it('darwin 不渲染', () => {
    mockWc()
    const { container } = render(<WindowControls platform="darwin" />)
    expect(container.firstChild).toBeNull()
  })
  it('linux 不渲染', () => {
    mockWc()
    const { container } = render(<WindowControls platform="linux" />)
    expect(container.firstChild).toBeNull()
  })
  it('win32 渲三键,点击各调 bridge', () => {
    const m = mockWc()
    render(<WindowControls platform="win32" />)
    fireEvent.click(screen.getByTestId('win-minimize'))
    fireEvent.click(screen.getByTestId('win-maximize'))
    fireEvent.click(screen.getByTestId('win-close'))
    expect(m.minimize).toHaveBeenCalledTimes(1)
    expect(m.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(m.close).toHaveBeenCalledTimes(1)
  })
  it('maximizeChanged 切换 data-max-state', async () => {
    const m = mockWc()
    render(<WindowControls platform="win32" />)
    expect(screen.getByTestId('win-maximize').getAttribute('data-max-state')).toBe('normal')
    m.emit(true)
    await waitFor(() =>
      expect(screen.getByTestId('win-maximize').getAttribute('data-max-state')).toBe('maximized'))
  })
})
