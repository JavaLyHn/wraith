// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WraithApi } from '../src/preload/index'
import type { ActivityItem, ActivitySnapshot, BackendEvent, SessionMeta } from '../src/shared/types'
import { SettingsProvider } from '../src/renderer/settings/SettingsContext'
import Sidebar from '../src/renderer/components/Sidebar'
import App from '../src/renderer/App'

// App 的活动路由只依赖这些面板的入口；在这里收窄非活动面板，避免它们各自的
// 独立请求把「活动快照、跨项目跳转和事件刷新」的集成契约淹没掉。
vi.mock('../src/renderer/components/TopBar', () => ({ default: () => <div data-testid="top-bar" /> }))
vi.mock('../src/renderer/components/SidebarDock', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../src/renderer/components/TaskPanel', () => ({
  default: ({ onBack }: { onBack(): void }) => <button data-testid="task-panel" onClick={onBack}>任务</button>,
}))
vi.mock('../src/renderer/components/AutomationsPanel', () => ({
  default: ({ onBack }: { onBack(): void }) => <button data-testid="automations-panel" onClick={onBack}>自动化</button>,
}))
vi.mock('../src/renderer/components/Composer', () => ({ default: () => <div data-testid="composer" /> }))
vi.mock('../src/renderer/components/WelcomeEmptyState', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('../src/renderer/components/RightDock', () => ({ default: () => <div /> }))
vi.mock('../src/renderer/components/CommandPalette', () => ({ default: () => <div /> }))
vi.mock('../src/renderer/components/TerminalDrawer', () => ({ default: () => <div /> }))

const projectA = 'D:/projects/alpha'
const projectB = 'D:/projects/bravo'

const session: SessionMeta = {
  id: 'session-bravo',
  cwd: projectB,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
  provider: 'test',
  model: 'test-model',
  title: '跨项目会话',
  turns: 1,
}

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    activityId: 'session:session-bravo',
    kind: 'session',
    status: 'running',
    projectPath: projectB,
    sessionId: 'session-bravo',
    title: '跨项目会话',
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function snapshot(activities: ActivityItem[], overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return { activities, stale: false, ...overrides }
}

type ActivityEvent = (value: ActivitySnapshot) => void
type AutomationEvent = (value: { kind: 'runs-changed' | 'badge' | 'approval' | 'open-panel'; show?: boolean; runId?: string; payload?: Record<string, unknown> }) => void

function installApi(initial: ActivitySnapshot) {
  let activityListener: ActivityEvent | undefined
  let automationListener: AutomationEvent | undefined
  let backendListener: ((event: BackendEvent) => void) | undefined
  const activityList = vi.fn(async () => initial)
  const api = {
    platform: 'win32',
    listEditors: vi.fn(async () => []),
    closeBehavior: {
      onRequest: vi.fn(() => () => {}),
      getMode: vi.fn(async () => 'ask'),
      execute: vi.fn(async () => undefined),
    },
    mcpResources: vi.fn(async () => ({ resources: [] })),
    gitStatus: vi.fn(async () => ({ isRepo: false })),
    onEvent: vi.fn((listener: (event: BackendEvent) => void) => {
      backendListener = listener
      return () => { backendListener = undefined }
    }),
    listSessions: vi.fn(async () => ({ sessions: [session] })),
    onAutomationEvent: vi.fn((listener: AutomationEvent) => {
      automationListener = listener
      return () => { automationListener = undefined }
    }),
    listProjects: vi.fn(async () => ({ projects: [] })),
    mcpList: vi.fn(async () => ({ servers: [] })),
    startSession: vi.fn(async () => ({ sessionId: 'current-session' })),
    resumeSession: vi.fn(async (id: string) => ({ sessionId: id, messages: [], cards: [] })),
    contextState: vi.fn(async () => ({})),
    sandboxGet: vi.fn(async () => ({ kind: 'none', networkAllowed: false })),
    getInitialWorkspace: vi.fn(async () => projectA),
    initialize: vi.fn(async () => ({ model: 'test-model', capabilities: { sandbox: 'none', modelConfigured: true } })),
    checkUpdate: vi.fn(async () => ({ hasUpdate: false })),
    taskList: vi.fn(async () => ({ enabled: false, tasks: [] })),
    activityList,
    activityCancel: vi.fn(async () => ({ ok: true })),
    onActivityEvent: vi.fn((listener: ActivityEvent) => {
      activityListener = listener
      return () => { activityListener = undefined }
    }),
    activateProject: vi.fn(async () => ({ ok: true })),
  }
  ;(window as unknown as { wraith: WraithApi }).wraith = api as unknown as WraithApi
  return {
    api,
    activityList,
    emitActivity: (value: ActivitySnapshot) => activityListener?.(value),
    emitAutomation: (value: Parameters<AutomationEvent>[0]) => automationListener?.(value),
    emitBackend: (value: BackendEvent) => backendListener?.(value),
  }
}

function renderApp(): void {
  render(<SettingsProvider><App /></SettingsProvider>)
}

function sidebarProps(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}): React.ComponentProps<typeof Sidebar> {
  return {
    workspace: projectA,
    projects: [],
    busy: false,
    sessions: [],
    activeSessionId: '',
    runningSessionId: '',
    newDraftActive: false,
    onNewConversation: vi.fn(),
    onSelectSession: vi.fn(),
    onToggleStar: vi.fn(),
    onRenameSession: vi.fn(),
    onArchiveSession: vi.fn(),
    onActivateProject: vi.fn(),
    onAddProject: vi.fn(),
    onOpenAllProjects: vi.fn(),
    profile: { name: '测试', avatar: 'T' },
    activeNav: 'activity',
    onOpenPlugins: vi.fn(),
    onOpenAutomations: vi.fn(),
    onOpenImGateway: vi.fn(),
    onOpenProviders: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenMemory: vi.fn(),
    onOpenSnapshots: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenPolicy: vi.fn(),
    onOpenBrowser: vi.fn(),
    onOpenRag: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenSettings: vi.fn(),
    automationBadge: false,
    taskActiveCount: 0,
    onOpenSearch: vi.fn(),
    activityCount: 2,
    onOpenActivity: vi.fn(),
    ...overrides,
  }
}

async function openActivity(): Promise<void> {
  fireEvent.click(screen.getByTestId('nav-tools-toggle'))
  fireEvent.click(screen.getByTestId('nav-activity'))
  await screen.findByRole('region', { name: '活动中心' })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('activity navigation', () => {
  it('keeps a visible activity entry, reports only active work in its badge, and opens through its own callback', () => {
    const onOpenActivity = vi.fn()
    render(<Sidebar {...sidebarProps({ onOpenActivity })} />)

    expect(screen.getByTestId('nav-activity-count').textContent).toBe('2')
    fireEvent.click(screen.getByTestId('nav-activity'))
    expect(onOpenActivity).toHaveBeenCalledOnce()
  })

  it('loads the activity view and routes a cross-project session through the existing project/session path', async () => {
    const activity = item()
    const { api } = installApi(snapshot([activity]))
    renderApp()

    await openActivity()
    fireEvent.click(screen.getByTestId('activity-open-session:session-bravo'))

    await waitFor(() => expect(api.activateProject).toHaveBeenCalledWith(projectB))
    expect(api.startSession).toHaveBeenCalledWith(projectB)
    await waitFor(() => expect(api.resumeSession).toHaveBeenLastCalledWith('session-bravo'))
  })

  it('routes task and automation cards into their existing panels', async () => {
    const { api } = installApi(snapshot([
      item({ activityId: 'task:task-1', kind: 'task', taskId: 'task-1', sessionId: undefined, title: '后台任务' }),
      item({ activityId: 'automation:run-1', kind: 'automation', runId: 'run-1', sessionId: undefined, title: '自动化' }),
    ]))
    renderApp()

    await openActivity()
    fireEvent.click(screen.getByTestId('activity-open-task:task-1'))
    expect(screen.getByTestId('task-panel')).toBeTruthy()

    fireEvent.click(screen.getByTestId('nav-activity'))
    await screen.findByRole('region', { name: '活动中心' })
    fireEvent.click(screen.getByTestId('activity-open-automation:run-1'))
    expect(screen.getByTestId('automations-panel')).toBeTruthy()
    expect(api.activityList).toHaveBeenCalled()
  })

  it('uses activity snapshots immediately and refreshes source changes and terminal session events without a new poller', async () => {
    const old = item({ activityId: 'task:old', kind: 'task', taskId: 'old', sessionId: undefined, title: '旧任务' })
    const changed = snapshot([
      old,
      item({ activityId: 'automation:new', kind: 'automation', runId: 'new', sessionId: undefined, status: 'waiting', title: '等待审批' }),
    ])
    const { activityList, emitActivity, emitAutomation, emitBackend } = installApi(snapshot([old]))
    renderApp()

    await openActivity()
    await waitFor(() => expect(activityList).toHaveBeenCalledTimes(1))
    act(() => emitActivity(changed))
    await waitFor(() => expect(screen.getByTestId('nav-activity-count').textContent).toBe('2'))

    act(() => emitAutomation({ kind: 'runs-changed' }))
    await waitFor(() => expect(activityList).toHaveBeenCalledTimes(2))
    act(() => emitBackend({ kind: 'notification', method: 'turn.failed', params: {} } as BackendEvent))
    await waitFor(() => expect(activityList).toHaveBeenCalledTimes(3))
  })

  it('keeps the last successful cards and marks them stale when a later refresh fails', async () => {
    const old = item({ activityId: 'task:still-visible', kind: 'task', taskId: 'still-visible', sessionId: undefined, title: '仍可查看' })
    const { activityList, emitAutomation } = installApi(snapshot([old]))
    renderApp()

    await openActivity()
    await waitFor(() => expect(screen.getByTestId('activity-card-task:still-visible')).toBeTruthy())
    activityList.mockRejectedValueOnce(new Error('活动查询失败'))
    act(() => emitAutomation({ kind: 'runs-changed' }))

    await waitFor(() => expect(screen.getByTestId('activity-stale').textContent).toContain('数据可能已过期'))
    expect(screen.getByTestId('activity-card-task:still-visible')).toBeTruthy()
  })
})
