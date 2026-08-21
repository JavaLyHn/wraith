import type { ActivitySnapshot, AutomationRun, DurableTaskView } from '../shared/types'
import type { ActivityStore } from './activityStore'

type ActivitySourceMethod = 'task.list' | 'automations.runs'

export interface ActivitySourceRefreshDependencies {
  store: ActivityStore
  request(method: ActivitySourceMethod, params: Record<string, never>): Promise<unknown>
  updateActivity(mutation: () => ActivitySnapshot): void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergeTasks(store: ActivityStore, tasks: DurableTaskView[]): ActivitySnapshot {
  let snapshot = store.clearSourceStale('task')
  for (const task of tasks) snapshot = store.registerTask(task)
  return snapshot
}

function mergeAutomations(store: ActivityStore, runs: AutomationRun[]): ActivitySnapshot {
  let snapshot = store.clearSourceStale('automation')
  for (const run of runs) snapshot = store.registerAutomation(run)
  return snapshot
}

/** Refreshes both read-only sources once when the activity list is explicitly requested. */
export async function refreshActivitySources(deps: ActivitySourceRefreshDependencies): Promise<void> {
  const [tasks, automations] = await Promise.allSettled([
    deps.request('task.list', {}),
    deps.request('automations.runs', {}),
  ])

  if (tasks.status === 'fulfilled') {
    const result = tasks.value as { tasks?: DurableTaskView[] }
    deps.updateActivity(() => mergeTasks(deps.store, result.tasks ?? []))
  } else {
    deps.updateActivity(() => deps.store.markSourceStale('task', errorText(tasks.reason)))
  }

  if (automations.status === 'fulfilled') {
    const result = automations.value as { runs?: AutomationRun[] }
    deps.updateActivity(() => mergeAutomations(deps.store, result.runs ?? []))
  } else {
    deps.updateActivity(() => deps.store.markSourceStale('automation', errorText(automations.reason)))
  }
}
