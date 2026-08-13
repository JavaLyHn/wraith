// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import ActivityPanel from '../src/renderer/components/ActivityPanel'
import type { ActivityItem, ActivitySnapshot } from '../src/shared/types'

afterEach(cleanup)

const activity = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  activityId: 'session:one',
  kind: 'session',
  status: 'running',
  projectPath: 'D:/projects/wraith',
  sessionId: 'one',
  title: '实现活动中心',
  startedAt: 1,
  updatedAt: 2,
  ...overrides,
})

const snapshot = (activities: ActivityItem[], overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot => ({
  activities,
  stale: false,
  ...overrides,
})

function renderPanel(value: ActivitySnapshot, overrides: Partial<ComponentProps<typeof ActivityPanel>> = {}) {
  const callbacks = {
    onBack: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenAutomation: vi.fn(),
    onRefresh: vi.fn(),
    onCancel: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
  render(<ActivityPanel snapshot={value} {...callbacks} />)
  return callbacks
}

describe('ActivityPanel', () => {
  it('renders running, waiting, and recent groups in the activity helper order', () => {
    renderPanel(snapshot([
      activity({ activityId: 'completed', status: 'completed', updatedAt: 1 }),
      activity({ activityId: 'waiting', status: 'waiting', updatedAt: 2 }),
      activity({ activityId: 'running', status: 'running', updatedAt: 3 }),
    ]))

    const headings = Array.from(screen.getAllByTestId('activity-group-heading')).map(node => node.textContent)
    expect(headings).toEqual(['正在运行', '等待处理', '最近结果'])
  })

  it('shows an empty state when the first successful snapshot has no activities', () => {
    renderPanel(snapshot([]))

    expect(screen.getByTestId('activity-empty')).toBeTruthy()
    expect(screen.getByText('暂无活动')).toBeTruthy()
  })

  it('marks stale snapshots explicitly without discarding their cards', () => {
    renderPanel(snapshot([activity()], { stale: true }))

    expect(screen.getByTestId('activity-stale').textContent).toContain('数据可能已过期')
    expect(screen.getByTestId('activity-card-session:one')).toBeTruthy()
  })

  it('shows a first-load error and lets the user retry', () => {
    const onRefresh = vi.fn()
    renderPanel(snapshot([], { error: '活动数据不可用' }), { onRefresh })

    expect(screen.getByTestId('activity-first-load-error').textContent).toContain('活动数据不可用')
    fireEvent.click(screen.getByTestId('activity-retry'))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('shows open and cancel actions only for running and waiting cards', () => {
    renderPanel(snapshot([
      activity({ activityId: 'running', status: 'running' }),
      activity({ activityId: 'waiting', status: 'waiting' }),
      activity({ activityId: 'completed', status: 'completed' }),
      activity({ activityId: 'failed', status: 'failed' }),
    ]))

    for (const id of ['running', 'waiting']) {
      expect(screen.getByTestId(`activity-open-${id}`)).toBeTruthy()
      expect(screen.getByTestId(`activity-cancel-${id}`)).toBeTruthy()
    }
    for (const id of ['completed', 'failed']) {
      expect(screen.getByTestId(`activity-open-${id}`)).toBeTruthy()
      expect(screen.queryByTestId(`activity-cancel-${id}`)).toBeNull()
    }
  })

  it('routes each open action with the original activity object', () => {
    const session = activity({ activityId: 'session:one', kind: 'session' })
    const task = activity({ activityId: 'task:one', kind: 'task', taskId: 'one', sessionId: undefined })
    const automation = activity({ activityId: 'automation:one', kind: 'automation', runId: 'one', sessionId: undefined })
    const callbacks = renderPanel(snapshot([session, task, automation]))

    fireEvent.click(screen.getByTestId('activity-open-session:one'))
    fireEvent.click(screen.getByTestId('activity-open-task:one'))
    fireEvent.click(screen.getByTestId('activity-open-automation:one'))

    expect((callbacks.onOpenSession as Mock<(item: ActivityItem) => void>).mock.calls[0]?.[0]).toBe(session)
    expect((callbacks.onOpenTask as Mock<(item: ActivityItem) => void>).mock.calls[0]?.[0]).toBe(task)
    expect((callbacks.onOpenAutomation as Mock<(item: ActivityItem) => void>).mock.calls[0]?.[0]).toBe(automation)
  })

  it('does not route a nested cancel button keyboard action through the focusable card', () => {
    const running = activity({ activityId: 'task:one', kind: 'task', taskId: 'one', sessionId: undefined })
    const onCancel = vi.fn(async () => ({ ok: true }))
    const callbacks = renderPanel(snapshot([running]), { onCancel })
    const cancel = screen.getByTestId('activity-cancel-task:one')

    fireEvent.keyDown(cancel, { key: 'Enter' })
    fireEvent.click(cancel)

    expect(onCancel).toHaveBeenCalledOnce()
    expect(callbacks.onOpenTask).not.toHaveBeenCalled()
  })

  it('keeps a failed cancellation status and shows the returned reason', async () => {
    const waiting = activity({ activityId: 'task:one', kind: 'task', taskId: 'one', sessionId: undefined, status: 'waiting' })
    const onCancel = vi.fn(async () => ({ ok: false, message: '任务已经结束，无法取消' }))
    renderPanel(snapshot([waiting]), { onCancel })

    fireEvent.click(screen.getByTestId('activity-cancel-task:one'))

    expect((await screen.findByTestId('activity-cancel-error-task:one')).textContent).toContain('任务已经结束，无法取消')
    expect(screen.getByTestId('activity-status-task:one').textContent).toContain('等待中')
    expect(onCancel).toHaveBeenCalledWith(waiting)
  })

  it('shows Git branch and worktree context without replacing the activity status', () => {
    renderPanel(snapshot([activity({
      status: 'waiting',
      branch: 'feat/activity',
      worktree: 'D:/projects/wraith',
      git: { branch: 'feat/activity', worktree: 'D:/projects/wraith', changedFiles: 3, additions: 12, deletions: 4 },
    })]))

    expect(screen.getByTestId('activity-git-session:one').textContent).toContain('feat/activity')
    expect(screen.getByTestId('activity-git-session:one').textContent).toContain('D:/projects/wraith')
    expect(screen.getByTestId('activity-status-session:one').textContent).toContain('等待中')
  })
})
