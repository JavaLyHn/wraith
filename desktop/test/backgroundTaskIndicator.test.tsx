// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from '../src/renderer/components/Sidebar'
import Transcript from '../src/renderer/components/Transcript'
import { addTaskDoneItem, initialState } from '../src/shared/transcriptReducer'

afterEach(cleanup)

type SidebarProps = React.ComponentProps<typeof Sidebar>

function sidebarProps(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    workspace: '/proj', projects: [], busy: false, sessions: [],
    activeSessionId: '', runningSessionId: '', newDraftActive: false,
    onNewConversation: vi.fn(), onSelectSession: vi.fn(), onToggleStar: vi.fn(),
    onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
    onActivateProject: vi.fn(), onAddProject: vi.fn(), onRemoveProject: vi.fn(), onRenameProject: vi.fn(),
    profile: { name: 'Haonan', avatar: '🦊' }, activeNav: 'plugins', taskActiveCount: 0,
    onOpenPlugins: vi.fn(), onOpenAutomations: vi.fn(), onOpenImGateway: vi.fn(),
    onOpenProviders: vi.fn(), onOpenSkills: vi.fn(), onOpenMemory: vi.fn(),
    onOpenSnapshots: vi.fn(), onOpenTasks: vi.fn(), onOpenPolicy: vi.fn(),
    onOpenBrowser: vi.fn(), onOpenRag: vi.fn(), onOpenDocuments: vi.fn(), onOpenSettings: vi.fn(),
    automationBadge: false, onOpenSearch: vi.fn(),
    ...over,
  }
}

/**
 * 后台任务此前只在打开面板时才看得见:丢出去之后对话里再无音讯,也不知道跑完没有。
 * 两个出口 —— 侧栏计数(现在有几个在跑)+ 对话里的静默药丸(刚才那个跑完了,点开看结果)。
 * 队列是全局的(与终端 /task 共享),故计数不区分会话。
 */
describe('侧栏后台任务计数', () => {
  it('有任务在跑 → nav-tasks 上显示数字', () => {
    render(<Sidebar {...sidebarProps({ taskActiveCount: 2 })} />)
    expect(screen.getByTestId('nav-tasks-count').textContent).toContain('2')
  })

  it('没有任务 → 不显示(0 不该占位)', () => {
    render(<Sidebar {...sidebarProps({ taskActiveCount: 0 })} />)
    expect(screen.queryByTestId('nav-tasks-count')).toBeNull()
  })

  it('工具组收起时计数冒到「工具」头部,否则收起就看不见了', () => {
    render(<Sidebar {...sidebarProps({ activeNav: null, taskActiveCount: 3 })} />)
    expect(screen.queryByTestId('nav-tasks')).toBeNull()          // 组确实收起了
    expect(screen.getByTestId('nav-tools-task-count').textContent).toBe('3')
  })

  it('展开时头部不重复显示(否则同一个数出现两次)', () => {
    render(<Sidebar {...sidebarProps({ activeNav: 'tasks', taskActiveCount: 3 })} />)
    expect(screen.getByTestId('nav-tasks-count')).toBeTruthy()
    expect(screen.queryByTestId('nav-tools-task-count')).toBeNull()
  })
})

describe('对话里的任务完成药丸', () => {
  const base = {
    busy: false, onEditMessage: vi.fn(), onDeleteMessage: vi.fn(), onResendMessage: vi.fn(),
    onPlanReview: vi.fn(), mode: 'react' as const, onOpenArtifact: vi.fn(), onOpenDiff: vi.fn(),
    onUndo: vi.fn(), editors: [], workspace: '/proj',
  }

  it('渲染文案,点击打开后台任务面板', () => {
    const onOpenPanel = vi.fn()
    const st = addTaskDoneItem(initialState, 't1', '后台任务完成:统计 java 文件数 · 11s', true)
    render(<Transcript {...base} items={st.items} onOpenPanel={onOpenPanel} />)
    const pill = screen.getByTestId('task-done-pill')
    expect(pill.textContent).toContain('统计 java 文件数')
    fireEvent.click(pill)
    expect(onOpenPanel).toHaveBeenCalledWith('tasks')
  })

  it('失败的任务用 danger 墨色区分', () => {
    const st = addTaskDoneItem(initialState, 't2', '后台任务失败:炸了', false)
    render(<Transcript {...base} items={st.items} onOpenPanel={vi.fn()} />)
    expect(screen.getByTestId('task-done-pill').className).toContain('danger')
  })

  it('同一个任务重复插入是幂等的', () => {
    // 轮询天然会重入(比对逻辑之外再加一道):同一 taskId 不该在对话里出现两遍
    let st = addTaskDoneItem(initialState, 't1', 'a', true)
    st = addTaskDoneItem(st, 't1', 'a', true)
    expect(st.items.filter((i) => i.type === 'task-done')).toHaveLength(1)
  })

  it('首页空态也能显药丸 —— 那里不渲染 Transcript,否则通知会丢', async () => {
    // 场景:从后台任务面板提交任务 → 回到一个全新会话(showWelcome)→ 任务完成。
    // Transcript 只在 hasStarted 时渲染,空态若不给插槽,这条通知就无处可去。
    const { default: WelcomeEmptyState } = await import('../src/renderer/components/WelcomeEmptyState')
    const { default: TaskDonePill } = await import('../src/renderer/components/TaskDonePill')
    const onOpen = vi.fn()
    render(
      <WelcomeEmptyState categories={[{ label: '了解这个项目', prompts: ['梳理这个目录的结构', '这个项目是做什么的'] }]} onPickExample={vi.fn()}
        notices={<TaskDonePill text="后台任务完成:数 md 文件 · 3s" ok onOpen={onOpen} />}>
        <div>composer</div>
      </WelcomeEmptyState>,
    )
    expect(screen.getByTestId('welcome-notices')).toBeTruthy()
    expect(screen.getByTestId('task-done-pill').textContent).toContain('数 md 文件')
    // 示例入口不能因为一条后台通知就消失 —— 空态的主职责还是"开始一段新对话"
    expect(screen.getByText('了解这个项目')).toBeTruthy()
    fireEvent.click(screen.getByTestId('task-done-pill'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('没有通知时空态不多出一个空容器', async () => {
    const { default: WelcomeEmptyState } = await import('../src/renderer/components/WelcomeEmptyState')
    render(<WelcomeEmptyState categories={[]} onPickExample={vi.fn()}><div>composer</div></WelcomeEmptyState>)
    expect(screen.queryByTestId('welcome-notices')).toBeNull()
  })

  it('药丸不进后端历史(纯 UI 态)', () => {
    // system-event 会作为带前缀的 user 消息回到后端;任务完成只是通知,不该引出一轮回复
    const st = addTaskDoneItem(initialState, 't1', 'a', true)
    expect(st.items.some((i) => i.type === 'system-event')).toBe(false)
    expect(st.items.some((i) => i.type === 'user')).toBe(false)
  })
})
