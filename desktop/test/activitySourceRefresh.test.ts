import { describe, expect, it, vi } from 'vitest'
import { ActivityStore } from '../src/main/activityStore'
import { refreshActivitySources } from '../src/main/activitySourceRefresh'
import type { ActivitySnapshot, AutomationRun, DurableTaskView } from '../src/shared/types'

const task: DurableTaskView = {
  id: 'task-now', status: 'running', prompt: '立即发现任务', createdAtMs: 100, durationMs: 0,
}

const run: AutomationRun = {
  runId: 'run-now', taskId: 'auto-now', status: 'waiting_approval', startedAt: 200, summary: '等待审批',
}

function updateActivity(mutation: () => ActivitySnapshot): void {
  mutation()
}

describe('activity source refresh', () => {
  it('discovers existing tasks and automation runs on the first activity-list refresh', async () => {
    const store = new ActivityStore()
    const request = vi.fn(async (method: 'task.list' | 'automations.runs') =>
      method === 'task.list' ? { tasks: [task] } : { runs: [run] })

    await refreshActivitySources({ store, request, updateActivity })

    expect(store.snapshot(10)).toMatchObject({
      stale: false,
      activities: expect.arrayContaining([
        expect.objectContaining({ activityId: 'task:task-now', status: 'running' }),
        expect.objectContaining({ activityId: 'automation:run-now', status: 'waiting' }),
      ]),
    })
  })

  it('marks only a failed task source stale while retaining successful automation data', async () => {
    const store = new ActivityStore()
    store.registerTask({ ...task, id: 'task-old' })
    const request = vi.fn(async (method: 'task.list' | 'automations.runs') => {
      if (method === 'task.list') throw new Error('task list unavailable')
      return { runs: [run] }
    })

    await refreshActivitySources({ store, request, updateActivity })

    const byId = new Map(store.snapshot(10).activities.map(item => [item.activityId, item]))
    expect(store.snapshot(10)).toMatchObject({ stale: true, error: 'task list unavailable' })
    expect(byId.get('task:task-old')).toMatchObject({ stale: true, error: 'task list unavailable' })
    expect(byId.get('automation:run-now')).toMatchObject({ status: 'waiting' })
    expect(byId.get('automation:run-now')).not.toHaveProperty('stale', true)
  })

  it('keeps an empty first list stale when one source could not be read', async () => {
    const store = new ActivityStore()
    const request = vi.fn(async (method: 'task.list' | 'automations.runs') => {
      if (method === 'task.list') throw new Error('task list unavailable')
      return { runs: [] }
    })

    await refreshActivitySources({ store, request, updateActivity })

    expect(store.snapshot(10)).toEqual({ activities: [], stale: true, error: 'task list unavailable' })
  })
})
