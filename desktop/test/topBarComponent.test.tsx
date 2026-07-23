// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import TopBar from '../src/renderer/components/TopBar'

afterEach(() => cleanup())
const base = { platform: 'darwin', sidebarCollapsed: false, onToggleSidebar: vi.fn(), showChat: true, terminalOpen: false, onToggleTerminal: vi.fn(), rightDockOpen: false, onToggleRightDock: vi.fn() }

describe('TopBar', () => {
  it('侧栏切换键恒显,点击触发 onToggleSidebar', () => {
    const onToggleSidebar = vi.fn()
    render(<TopBar {...base} onToggleSidebar={onToggleSidebar} />)
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(onToggleSidebar).toHaveBeenCalled()
  })
  it('showChat=true:终端/右栏键在,点击各触发回调', () => {
    const onToggleTerminal = vi.fn(); const onToggleRightDock = vi.fn()
    render(<TopBar {...base} showChat onToggleTerminal={onToggleTerminal} onToggleRightDock={onToggleRightDock} />)
    fireEvent.click(screen.getByTestId('terminal-toggle')); expect(onToggleTerminal).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('rightdock-toggle')); expect(onToggleRightDock).toHaveBeenCalled()
  })
  it('showChat=false:终端/右栏键不渲染,侧栏键仍在', () => {
    render(<TopBar {...base} showChat={false} />)
    expect(screen.queryByTestId('terminal-toggle')).toBeNull()
    expect(screen.queryByTestId('rightdock-toggle')).toBeNull()
    expect(screen.getByTestId('sidebar-toggle')).toBeTruthy()
  })

  it('侧栏 glyph 反映折叠态:展开=open、折叠=关', () => {
    const { rerender } = render(<TopBar {...base} sidebarCollapsed={false} />)
    const fill = () => within(screen.getByTestId('sidebar-toggle')).getByTestId('panel-fill')
    expect(fill().getAttribute('data-open')).toBe('true')
    expect(fill().getAttribute('data-side')).toBe('left')
    rerender(<TopBar {...base} sidebarCollapsed={true} />)
    expect(fill().getAttribute('data-open')).toBe('false')
  })

  it('终端/右栏 glyph 随各自 open prop 翻转,side 正确', () => {
    render(<TopBar {...base} terminalOpen rightDockOpen={false} />)
    const term = within(screen.getByTestId('terminal-toggle')).getByTestId('panel-fill')
    const dock = within(screen.getByTestId('rightdock-toggle')).getByTestId('panel-fill')
    expect(term.getAttribute('data-open')).toBe('true')
    expect(term.getAttribute('data-side')).toBe('bottom')
    expect(dock.getAttribute('data-open')).toBe('false')
    expect(dock.getAttribute('data-side')).toBe('right')
  })
})
