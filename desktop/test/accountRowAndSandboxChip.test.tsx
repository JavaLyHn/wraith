// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from '../src/renderer/components/Sidebar'
import TopBar from '../src/renderer/components/TopBar'
import { sandboxChipView } from '../src/renderer/lib/topBar'

afterEach(cleanup)

type SidebarProps = React.ComponentProps<typeof Sidebar>

function sidebarProps(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    workspace: '/proj', projects: [], busy: false, sessions: [],
    activeSessionId: '', runningSessionId: '', newDraftActive: false,
    onNewConversation: vi.fn(), onSelectSession: vi.fn(), onToggleStar: vi.fn(),
    onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
    onActivateProject: vi.fn(), onAddProject: vi.fn(), onRemoveProject: vi.fn(), onRenameProject: vi.fn(),
    profile: { name: 'Haonan', avatar: '🦊' }, activeNav: null, taskActiveCount: 0,
    onOpenPlugins: vi.fn(), onOpenAutomations: vi.fn(), onOpenImGateway: vi.fn(),
    onOpenProviders: vi.fn(), onOpenSkills: vi.fn(), onOpenMemory: vi.fn(),
    onOpenSnapshots: vi.fn(), onOpenTasks: vi.fn(), onOpenPolicy: vi.fn(),
    onOpenBrowser: vi.fn(), onOpenRag: vi.fn(), onOpenSettings: vi.fn(),
    automationBadge: false, onOpenSearch: vi.fn(),
    ...over,
  }
}

const topBarProps = {
  platform: 'darwin', sidebarCollapsed: false, onToggleSidebar: vi.fn(),
  showChat: true, terminalOpen: false, onToggleTerminal: vi.fn(),
  rightDockOpen: false, onToggleRightDock: vi.fn(),
  sandbox: 'macos-seatbelt' as const, onOpenPolicy: vi.fn(),
}

/**
 * 侧栏左下角原来是「⚙ 设置」一行 + 「沙箱: Seatbelt」一行灰字。两处都改了:
 *  - 设置入口改成账户行(头像 + 昵称),数据取自设置→「我」已有的 prefs.profile,不新造身份概念;
 *  - 沙箱状态搬到顶栏的盾图标 —— 它只在异常那一刻才有价值,常态占一行讲「一切正常」是版面浪费,
 *    但也不能藏进面板里(没沙箱是要立刻看见的事),所以放全局恒显的顶栏。
 */
describe('侧栏账户行', () => {
  it('显示 prefs.profile 的头像与昵称', () => {
    render(<Sidebar {...sidebarProps()} />)
    expect(screen.getByTestId('account-avatar').textContent).toBe('🦊')
    expect(screen.getByTestId('account-name').textContent).toBe('Haonan')
  })

  it('avatar 为空时退回昵称首字(复用 userAvatarGlyph 口径)', () => {
    render(<Sidebar {...sidebarProps({ profile: { name: 'Haonan', avatar: '' } })} />)
    expect(screen.getByTestId('account-avatar').textContent).toBe('H')
  })

  it('默认状态(name=我 + 无 avatar)不渲染成「我 我」', () => {
    // DEFAULT_PREFS 就是这个,即绝大多数用户看到的第一眼。字形回落到昵称首字 → 与昵称同字。
    const { container } = render(<Sidebar {...sidebarProps({ profile: { name: '我', avatar: '' } })} />)
    expect(screen.getByTestId('account-name').textContent).toBe('我')
    expect(screen.getByTestId('account-avatar').textContent).toBe('')  // 让位给通用图标
    expect(screen.getByTestId('account-avatar').querySelector('svg')).toBeTruthy()
    expect(container.textContent).not.toContain('我我')
  })

  it('一旦设了 emoji 或多字昵称,字形就恢复(不误伤正常情况)', () => {
    render(<Sidebar {...sidebarProps({ profile: { name: '我', avatar: '🦊' } })} />)
    expect(screen.getByTestId('account-avatar').textContent).toBe('🦊')
    cleanup()
    render(<Sidebar {...sidebarProps({ profile: { name: 'Haonan', avatar: '' } })} />)
    expect(screen.getByTestId('account-avatar').textContent).toBe('H')
  })

  it('昵称被清空时兜底为「我」,不能只剩个头像', () => {
    // 设置里那个昵称输入框允许空串,所以这是可达状态
    render(<Sidebar {...sidebarProps({ profile: { name: '   ', avatar: '🦊' } })} />)
    expect(screen.getByTestId('account-name').textContent).toBe('我')
  })

  it('点整行进设置(不只是点齿轮)', () => {
    const onOpenSettings = vi.fn()
    render(<Sidebar {...sidebarProps({ onOpenSettings })} />)
    fireEvent.click(screen.getByTestId('account-name'))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('activeNav=settings 时账户行有活动态高亮', () => {
    const { container } = render(<Sidebar {...sidebarProps({ activeNav: 'settings' })} />)
    const row = container.querySelector('[data-testid="nav-settings"]')!
    // 原来的「设置」按钮在 activeNav=settings 时没有任何视觉反馈,进了设置页侧栏看不出来
    expect(row.className).toContain('bg-fg/10')
  })

  it('静止态就要看得出能点:有底色 + 齿轮常显', () => {
    // v1 是「无底色 + 齿轮只在 group-hover 才 opacity-100」,静止态一个可点信号都没有,读作装饰。
    // 这条钉住可供性,免得下次又被「简洁」掉。
    const { container } = render(<Sidebar {...sidebarProps()} />)
    const row = container.querySelector('[data-testid="nav-settings"]')!
    expect(row.className, '静止态没有底色,不像个控件').toMatch(/bg-fg\/5/)
    const gear = row.querySelector('svg.lucide-settings') ?? row.querySelectorAll('svg')[row.querySelectorAll('svg').length - 1]
    expect(gear, '齿轮不在').toBeTruthy()
    expect(gear!.getAttribute('class') ?? '', '齿轮静止态被藏起来了').not.toMatch(/opacity-0/)
  })

  it('昵称是主标签,不能比装饰性的头像还淡', () => {
    const { container } = render(<Sidebar {...sidebarProps()} />)
    const name = container.querySelector('[data-testid="account-name"]')!
    expect(name.className).toContain('text-fg')
    expect(name.className).not.toContain('text-fg-muted')
  })

  it('侧栏底部不再有沙箱文案(已搬到顶栏)', () => {
    const { container } = render(<Sidebar {...sidebarProps()} />)
    expect(container.textContent).not.toContain('沙箱')
    expect(container.querySelector('[data-testid="sandbox-badge"]')).toBeNull()
  })
})

describe('顶栏沙箱盾', () => {
  it('三种状态各有自己的无障碍名,「未启用」是异常态的判定词', () => {
    expect(sandboxChipView('macos-seatbelt', 'darwin').label).toBe('沙箱: Seatbelt')
    expect(sandboxChipView('none', 'darwin').label).toBe('沙箱未启用')
    expect(sandboxChipView('unknown', 'darwin').label).toBe('沙箱状态未知')
  })

  it('只有未启用用 danger 墨色;正常态压到 muted,不跟其它顶栏键争注意力', () => {
    expect(sandboxChipView('none', 'darwin').tone).toContain('text-danger')
    expect(sandboxChipView('macos-seatbelt', 'darwin').tone).not.toContain('danger')
    expect(sandboxChipView('unknown', 'darwin').tone).not.toContain('danger')
  })

  it('渲染在顶栏,aria-label 带状态', () => {
    render(<TopBar {...topBarProps} sandbox="none" />)
    expect(screen.getByTestId('sandbox-badge').getAttribute('aria-label')).toBe('沙箱未启用')
  })

  it('点击进「安全」面板', () => {
    const onOpenPolicy = vi.fn()
    render(<TopBar {...topBarProps} onOpenPolicy={onOpenPolicy} />)
    fireEvent.click(screen.getByTestId('sandbox-badge'))
    expect(onOpenPolicy).toHaveBeenCalled()
  })

  it('showChat=false(在面板页)时盾仍在 —— 沙箱是全局态,不该跟着对话页消失', () => {
    render(<TopBar {...topBarProps} showChat={false} />)
    expect(screen.getByTestId('sandbox-badge')).toBeTruthy()
    expect(screen.queryByTestId('terminal-toggle')).toBeNull() // 对照:终端键确实按 showChat 收起了
  })

  it('盾是 no-drag 的,否则点它会变成拖窗口', () => {
    render(<TopBar {...topBarProps} />)
    expect(screen.getByTestId('sandbox-badge').className).toContain('no-drag')
  })
})

/**
 * 后端的 `CommandSandbox.available()` 判的是 `os.name contains "mac" && /usr/bin/sandbox-exec 可执行`,
 * 所以 Windows / Linux **恒定**拿到 `capabilities.sandbox = 'none'`(jshell 实测:Windows=false→none)。
 *
 * 这意味着盾牌一旦只看后端回包,在 Windows 上就是一颗**永远消不掉的红点**,
 * tooltip 还写着「点击查看安全设置」—— 用户点进去无事可做。
 * 那不只是刺眼,是在说假话:它暗示存在一处可修的错配。
 * 判据必须是 platform:同一个 `none`,在 mac 上可行动(该红),在别处不可行动(不该红)。
 */
describe('沙箱盾在非 mac 平台', () => {
  /** win32 下 TopBar 会挂 WindowControls,它在 mount 时就读 window.wraith.windowControls。 */
  function stubWindowControls(): void {
    ;(window as unknown as { wraith: unknown }).wraith = {
      platform: 'win32',
      windowControls: {
        minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(),
        isMaximized: vi.fn(async () => false), onMaximizeChange: vi.fn(() => () => {}),
      },
    }
  }

  it('win32 + none:不是 danger —— 平台不支持不是可行动的告警', () => {
    expect(sandboxChipView('none', 'win32').tone).not.toContain('danger')
    expect(sandboxChipView('none', 'linux').tone).not.toContain('danger')
  })

  it('win32 + none:文案说「平台无沙箱」,不说「未启用」', () => {
    const v = sandboxChipView('none', 'win32')
    expect(v.label).toBe('当前平台无沙箱')
    expect(v.label).not.toContain('未启用')   // 「未启用」专属 mac 异常态,别复用
  })

  it('win32 + none:tooltip 交代清楚还剩什么保护,不留悬念', () => {
    expect(sandboxChipView('none', 'win32').title).toContain('黑名单')
  })

  it('kind 与 mac 异常态是两个值 —— 图标据此分岔(plain Shield vs ShieldAlert)', () => {
    expect(sandboxChipView('none', 'win32').kind).toBe('unsupported')
    expect(sandboxChipView('none', 'darwin').kind).toBe('off')
  })

  it('mac 上 none 仍然红 —— 修 Windows 不能顺手把 mac 的真告警一起消音', () => {
    expect(sandboxChipView('none', 'darwin').tone).toContain('text-danger')
  })

  it('端到端:platform=win32 的顶栏渲染出的是「无沙箱」而非红色「未启用」', () => {
    stubWindowControls()
    render(<TopBar {...topBarProps} platform="win32" sandbox="none" />)
    const badge = screen.getByTestId('sandbox-badge')
    expect(badge.getAttribute('aria-label')).toBe('当前平台无沙箱')
    expect(badge.className).not.toContain('danger')
  })

  it('win32 下盾与自绘窗控同时在场,且盾排在窗控左边(不抢窗控的角落)', () => {
    // 这个组合此前从未被渲染过一次:win32 的用例 sandbox 恒为 macos-seatbelt,
    // 而 Windows 上真正会发生的只有 none。
    stubWindowControls()
    const { container } = render(<TopBar {...topBarProps} platform="win32" sandbox="none" />)
    const badge = screen.getByTestId('sandbox-badge')
    const controls = screen.getByTestId('window-controls')
    expect(container.contains(badge) && container.contains(controls)).toBe(true)
    // compareDocumentPosition: FOLLOWING(4) 表示 controls 在 badge 之后
    expect(badge.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
