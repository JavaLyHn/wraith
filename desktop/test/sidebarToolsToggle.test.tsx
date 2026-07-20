// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    onRenameSession: noop, onDeleteSession: noop, onActivateProject: noop,
    onAddProject: noop, onRemoveProject: noop, onRenameProject: noop,
    sandbox: 'none', activeNav: null,
    onOpenPlugins: noop, onOpenAutomations: noop, onOpenImGateway: noop,
    onOpenProviders: noop, onOpenSkills: noop, onOpenMemory: noop,
    onOpenSnapshots: noop, onOpenTasks: noop, onOpenPolicy: noop,
    onOpenBrowser: noop, onOpenRag: noop, onOpenSettings: noop,
    automationBadge: false, onOpenSearch: noop,
    collapsed: false, onToggleCollapsed: noop,
    ...over,
  } as SidebarProps
}

describe('侧栏「工具」分组展开/折叠', () => {
  it('闲置态:点头部展开→再点收起(基础 toggle)', () => {
    render(<Sidebar {...props({ activeNav: null })} />)
    expect(screen.queryByTestId('nav-plugins')).toBeNull()          // 默认折叠
    fireEvent.click(screen.getByTestId('nav-tools-toggle'))
    expect(screen.queryByTestId('nav-plugins')).not.toBeNull()      // 展开
    fireEvent.click(screen.getByTestId('nav-tools-toggle'))
    expect(screen.queryByTestId('nav-plugins')).toBeNull()          // 收起
  })

  it('在工具页时点「工具」头部能收起(bug:此前 activeNav!==null 强制展开压过手动收起)', () => {
    render(<Sidebar {...props({ activeNav: 'policy' })} />)
    // 进入工具页自动展开(高亮可见)
    expect(screen.queryByTestId('nav-plugins')).not.toBeNull()
    // 用户点「工具」想收起
    fireEvent.click(screen.getByTestId('nav-tools-toggle'))
    // 期望:收起。此前的 bug 里这里仍展开,只有切回对话(activeNav→null)才收得起。
    expect(screen.queryByTestId('nav-plugins')).toBeNull()
  })

  it('手动收起后,导航到另一个工具页会重新展开(保留高亮可见的本意)', () => {
    const { rerender } = render(<Sidebar {...props({ activeNav: 'policy' })} />)
    fireEvent.click(screen.getByTestId('nav-tools-toggle'))          // 手动收起
    expect(screen.queryByTestId('nav-plugins')).toBeNull()
    rerender(<Sidebar {...props({ activeNav: 'memory' })} />)        // 切到另一工具页
    expect(screen.queryByTestId('nav-plugins')).not.toBeNull()      // 自动重新展开
  })
})
