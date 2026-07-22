// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
})
