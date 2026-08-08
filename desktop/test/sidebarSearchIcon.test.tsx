// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from '../src/renderer/components/Sidebar'

beforeEach(() => {
  ;(window as unknown as { wraith: { platform: string } }).wraith = { platform: 'darwin' }
})
afterEach(cleanup)

const noop = (): void => {}
type SidebarProps = Parameters<typeof Sidebar>[0]

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    workspace: '/w', projects: [], busy: false, sessions: [], activeSessionId: '',
    runningSessionId: '', newDraftActive: false,
    onNewConversation: noop, onSelectSession: noop, onToggleStar: noop,
    onRenameSession: noop, onArchiveSession: noop, onActivateProject: noop,
    onAddProject: noop, onRemoveProject: noop, onRenameProject: noop,
    profile: { name: 'Haonan', avatar: '🦊' }, activeNav: null,
    onOpenPlugins: noop, onOpenAutomations: noop, onOpenImGateway: noop,
    onOpenProviders: noop, onOpenSkills: noop, onOpenMemory: noop,
    onOpenSnapshots: noop, onOpenTasks: noop, onOpenPolicy: noop,
    onOpenBrowser: noop, onOpenRag: noop, onOpenSettings: noop,
    automationBadge: false, onOpenSearch: noop,
    collapsed: false, onToggleCollapsed: noop,
    ...over,
  } as SidebarProps
}

describe('搜索入口:移到 WRAITH 右侧、只留放大镜', () => {
  it('只剩一个搜索入口,且不在 nav 列表里', () => {
    render(<Sidebar {...props()} />)
    const all = screen.getAllByTestId('nav-search')
    expect(all).toHaveLength(1)
    expect(all[0]!.closest('nav')).toBeNull()   // 原来那行独立「搜索」项已移除
  })

  it('与 WRAITH 标题同处头部一行', () => {
    render(<Sidebar {...props()} />)
    const brand = screen.getByTestId('brand-home')
    const search = screen.getByTestId('nav-search')
    expect(search.parentElement).toBe(brand.parentElement)
  })

  it('只有图标,没有「搜索」文字', () => {
    render(<Sidebar {...props()} />)
    const search = screen.getByTestId('nav-search')
    expect(search.textContent?.trim()).toBe('')
    expect(search.querySelector('svg')).not.toBeNull()
    // 无文字则必须有无障碍名称,否则读屏用户只听到「按钮」
    expect(search.getAttribute('aria-label')).toBeTruthy()
  })

  it('点击只打开搜索,不会连带触发「新对话」', () => {
    const onOpenSearch = vi.fn()
    const onNewConversation = vi.fn()
    render(<Sidebar {...props({ onOpenSearch, onNewConversation })} />)
    fireEvent.click(screen.getByTestId('nav-search'))
    expect(onOpenSearch).toHaveBeenCalledTimes(1)
    // brand-home 也在这一行且点了会新建会话 —— 放进去后必须确认没被它吃掉
    expect(onNewConversation).not.toHaveBeenCalled()
  })
})
