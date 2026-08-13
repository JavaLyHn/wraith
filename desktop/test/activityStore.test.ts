import { describe, expect, it } from 'vitest'
import { ActivityStore, isDurableTaskSnapshot, sessionStatusForNotification } from '../src/main/activityStore'
import type { AutomationRun, DurableTaskView } from '../src/shared/types'

const session = (id: string) => ({
  sessionId: id,
  projectPath: 'D:/projects/wraith',
  title: 'Implement activity center',
  startedAt: 100,
})

const task = (id: string, status: DurableTaskView['status']): DurableTaskView => ({
  id,
  status,
  prompt: 'Inspect the repository',
  createdAtMs: 200,
  durationMs: 50,
})

const automation = (runId: string, status: AutomationRun['status']): AutomationRun => ({
  runId,
  taskId: 'automation-1',
  status,
  startedAt: 300,
  summary: 'Nightly review',
})

describe('ActivityStore', () => {
  it('uses stable source-prefixed activity ids', () => {
    const store = new ActivityStore()
    store.registerSession(session('s-1'))
    store.registerTask(task('t-1', 'running'))
    store.registerAutomation(automation('r-1', 'running'))

    expect(store.snapshot(10).activities.map(item => item.activityId).sort()).toEqual([
      'automation:r-1', 'session:s-1', 'task:t-1',
    ])
  })

  it('moves a submitted session from running to waiting then completed', () => {
    const store = new ActivityStore()
    store.registerSession(session('s-1'))
    expect(store.snapshot(10).activities[0]?.status).toBe('running')

    store.updateSession('s-1', { status: 'waiting' })
    expect(store.snapshot(10).activities[0]?.status).toBe('waiting')

    store.updateSession('s-1', { status: 'completed' })
    expect(store.snapshot(10).activities[0]?.status).toBe('completed')
  })

  it('maps a disconnect to interrupted when a session was active and unknown otherwise', () => {
    const active = new ActivityStore()
    active.registerSession(session('active'))
    active.markStale('backend disconnected')
    expect(active.snapshot(10).activities[0]).toMatchObject({ status: 'interrupted', error: 'backend disconnected' })

    const waiting = new ActivityStore()
    waiting.registerSession(session('waiting'))
    waiting.updateSession('waiting', { status: 'waiting' })
    waiting.markStale('backend disconnected')
    expect(waiting.snapshot(10).activities[0]).toMatchObject({ status: 'unknown', error: 'backend disconnected' })
  })

  it('maps durable task and automation wire statuses into activity statuses', () => {
    const store = new ActivityStore()
    store.registerTask(task('queued', 'enqueued'))
    store.registerTask(task('done', 'completed'))
    store.registerTask(task('cancelled', 'canceled'))
    store.registerAutomation(automation('waiting', 'waiting_approval'))
    store.registerAutomation(automation('success', 'success'))
    store.registerAutomation(automation('failed', 'failed'))
    store.registerAutomation(automation('interrupted', 'interrupted'))

    const statuses = Object.fromEntries(store.snapshot(20).activities.map(item => [item.activityId, item.status]))
    expect(statuses).toMatchObject({
      'task:queued': 'running', 'task:done': 'completed', 'task:cancelled': 'canceled',
      'automation:waiting': 'waiting', 'automation:success': 'completed',
      'automation:failed': 'failed', 'automation:interrupted': 'interrupted',
    })
  })

  it('replaces matching source snapshots instead of creating duplicate rows', () => {
    const store = new ActivityStore()
    store.registerTask(task('t-1', 'running'))
    store.mergeSnapshot([{ ...store.snapshot(10).activities[0]!, status: 'completed', updatedAt: 999 }])

    const items = store.snapshot(10).activities
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ activityId: 'task:t-1', status: 'completed', updatedAt: 999 })
  })

  it('marks a failed snapshot stale while retaining the last successful items', () => {
    const store = new ActivityStore()
    store.registerSession(session('s-1'))
    const stale = store.markStale('backend unavailable')

    expect(stale).toMatchObject({ stale: true, error: 'backend unavailable' })
    expect(stale.activities).toHaveLength(1)
    expect(stale.activities[0]).toMatchObject({ activityId: 'session:s-1', stale: true })
  })

  it('returns an unchanged snapshot when polling repeats a durable task', () => {
    const store = new ActivityStore()
    const first = store.registerTask(task('t-1', 'running'))
    const repeated = store.registerTask(task('t-1', 'running'))

    expect(repeated).toEqual(first)
  })

  it('maps the app-server turn.failed notification to a failed terminal session', () => {
    expect(sessionStatusForNotification('turn.failed')).toBe('failed')
  })

  it('does not treat a task.cancel acknowledgement as a durable task snapshot', () => {
    expect(isDurableTaskSnapshot({ ok: true })).toBe(false)
  })

  it('promotes a temporary running session to its persistent id without duplicate rows', () => {
    const store = new ActivityStore()
    store.registerSession(session('sess_temporary'))
    store.promoteSession('sess_temporary', '20260813T123000')

    expect(store.snapshot(10).activities).toEqual([
      expect.objectContaining({ activityId: 'session:20260813T123000', sessionId: '20260813T123000' }),
    ])
  })
})
