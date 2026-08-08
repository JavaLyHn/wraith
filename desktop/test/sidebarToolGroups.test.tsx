// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from '../src/renderer/components/Sidebar'

afterEach(cleanup)

type SidebarProps = React.ComponentProps<typeof Sidebar>

/** 12 个工具项各自的回调,便于逐个验证「重构后线没接错」。 */
function toolHandlers() {
  return {
    onOpenPlugins: vi.fn(), onOpenAutomations: vi.fn(), onOpenImGateway: vi.fn(),
    onOpenProviders: vi.fn(), onOpenSkills: vi.fn(), onOpenMemory: vi.fn(),
    onOpenSnapshots: vi.fn(), onOpenTasks: vi.fn(), onOpenPolicy: vi.fn(),
    onOpenBrowser: vi.fn(), onOpenRag: vi.fn(), onOpenDocuments: vi.fn(),
  }
}

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    workspace: '/proj', projects: [], busy: false, sessions: [],
    activeSessionId: '', runningSessionId: '', newDraftActive: false,
    onNewConversation: vi.fn(), onSelectSession: vi.fn(), onToggleStar: vi.fn(),
    onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
    onActivateProject: vi.fn(), onAddProject: vi.fn(), onOpenAllProjects: vi.fn(),
    profile: { name: 'Haonan', avatar: '🦊' }, taskActiveCount: 0,
    activeNav: 'plugins',   // 非 null → 工具组默认展开
    ...toolHandlers(),
    onOpenSettings: vi.fn(), automationBadge: false, onOpenSearch: vi.fn(),
    ...over,
  }
}

/** 侧栏 DOM 顺序里,某个 testid 的位置。 */
function orderOf(container: HTMLElement, testId: string): number {
  const all = [...container.querySelectorAll('[data-testid],div')]
  return all.findIndex((el) => el.getAttribute('data-testid') === testId)
}

/**
 * 工具项曾是 11 个手写按钮平铺 —— 扫一遍要过 11 行,且每个按钮都在重复同一段 active class。
 * 改为按「什么时候会点它」分三组(配置/运行/观察)+ 数据驱动渲染。
 *
 * 只加小标题、不做逐组折叠:分段是为了扫得快,不是为了藏起来;「工具」本身已能整体折叠。
 */
describe('侧栏工具分组', () => {
  it('四个组标题都在', () => {
    render(<Sidebar {...props()} />)
    for (const g of ['配置', '运行', '观察', '资料']) expect(screen.getByText(g)).toBeTruthy()
  })

  it('12 个工具项一个不少(重构不能丢项)', () => {
    render(<Sidebar {...props()} />)
    const ids = ['nav-plugins', 'nav-providers', 'nav-skills', 'nav-automations', 'nav-im-gateway',
      'nav-tasks', 'nav-memory', 'nav-snapshots', 'nav-policy', 'nav-browser', 'nav-rag', 'nav-documents']
    for (const id of ids) expect(screen.getByTestId(id), id + ' 丢了').toBeTruthy()
  })

  it('每一项都还接在自己的回调上(数据驱动最容易错位的地方)', () => {
    const h = toolHandlers()
    render(<Sidebar {...props(h)} />)
    const pairs: [string, keyof typeof h][] = [
      ['nav-plugins', 'onOpenPlugins'], ['nav-providers', 'onOpenProviders'], ['nav-skills', 'onOpenSkills'],
      ['nav-automations', 'onOpenAutomations'], ['nav-im-gateway', 'onOpenImGateway'], ['nav-tasks', 'onOpenTasks'],
      ['nav-memory', 'onOpenMemory'], ['nav-snapshots', 'onOpenSnapshots'], ['nav-policy', 'onOpenPolicy'],
      ['nav-browser', 'onOpenBrowser'], ['nav-rag', 'onOpenRag'], ['nav-documents', 'onOpenDocuments'],
    ]
    for (const [testId, cb] of pairs) {
      fireEvent.click(screen.getByTestId(testId))
      expect(h[cb], testId + ' → ' + String(cb) + ' 没被调到').toHaveBeenCalledTimes(1)
    }
    // 交叉检查:点了 12 次,每个回调恰好 1 次 —— 若两个项指向同一个 handler,上面会漏掉
    for (const cb of Object.values(h)) expect(cb).toHaveBeenCalledTimes(1)
  })

  it('代码检索归「观察」,排在浏览器之后', () => {
    const { container } = render(<Sidebar {...props()} />)
    expect(orderOf(container, 'nav-browser')).toBeLessThan(orderOf(container, 'nav-rag'))
    // 且在「运行」组之后 —— 证明它确实落在第三组而不是第一组
    expect(orderOf(container, 'nav-tasks')).toBeLessThan(orderOf(container, 'nav-rag'))
  })

  it('分组顺序:配置 → 运行 → 观察', () => {
    const { container } = render(<Sidebar {...props()} />)
    expect(orderOf(container, 'nav-plugins')).toBeLessThan(orderOf(container, 'nav-automations'))
    expect(orderOf(container, 'nav-automations')).toBeLessThan(orderOf(container, 'nav-memory'))
  })

  it('「资料」组排在「观察」之后(它是「我的东西」,不属于前三组的 agent 工作流)', () => {
    const { container } = render(<Sidebar {...props()} />)
    expect(orderOf(container, 'nav-rag')).toBeLessThan(orderOf(container, 'nav-documents'))
  })

  it('红点仍挂在自动化项上(它只可能出现在「运行」组)', () => {
    render(<Sidebar {...props({ automationBadge: true })} />)
    expect(screen.getByTestId('nav-automations-badge')).toBeTruthy()
  })

  it('活动项高亮仍生效', () => {
    render(<Sidebar {...props({ activeNav: 'rag' })} />)
    expect(screen.getByTestId('nav-rag').className).toContain('bg-fg/10')
    expect(screen.getByTestId('nav-plugins').className).not.toContain('bg-fg/10')
  })

  it('工具组收起时所有项与组标题一起消失', () => {
    render(<Sidebar {...props({ activeNav: null })} />)   // activeNav=null → 默认收起
    expect(screen.queryByTestId('nav-rag')).toBeNull()
    expect(screen.queryByText('观察')).toBeNull()
  })
})
