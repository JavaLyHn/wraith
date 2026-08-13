import type { ActivityCancelRequest, ActivityCancelResult, ActivityItem, ActivityKind, ActivitySnapshot } from '../shared/types'

export interface ActivityIpcRegistration {
  handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void
  snapshot(limit: number): ActivitySnapshot
  request(method: 'turn.interrupt' | 'task.cancel', params: Record<string, string | null>): Promise<unknown>
  currentSessionId(): string | null
  sessionInterruptParams(item: ActivityItem): Record<string, string | null>
}

type ActivityCancelTarget = ActivityCancelRequest

function isActivityCancelTarget(value: unknown): value is ActivityCancelTarget {
  if (!value || typeof value !== 'object') return false
  const { kind, id } = value as { kind?: unknown; id?: unknown }
  return (kind === 'session' || kind === 'task' || kind === 'automation')
    && typeof id === 'string' && id.length > 0
}

function activeActivity(snapshot: ActivitySnapshot, target: ActivityCancelTarget): ActivityItem | undefined {
  return snapshot.activities.find(item => item.kind === target.kind
    && item.activityId === `${target.kind}:${target.id}`
    && (item.status === 'running' || item.status === 'waiting'))
}

function cancelResult(value: unknown): ActivityCancelResult {
  if (!value || typeof value !== 'object' || typeof (value as { ok?: unknown }).ok !== 'boolean') return { ok: true }
  const { ok, message } = value as { ok: boolean; message?: unknown }
  return typeof message === 'string' ? { ok, message } : { ok }
}

function failure(error: unknown): ActivityCancelResult {
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

function sourceId(item: ActivityItem): string | undefined {
  switch (item.kind) {
    case 'session': return item.sessionId
    case 'task': return item.taskId
    case 'automation': return item.runId
  }
}

/** Registers the renderer's narrow activity surface; callers cannot choose arbitrary RPC names. */
export function registerActivityIpc(deps: ActivityIpcRegistration): void {
  deps.handle('wraith:activityList', (_event, limit?: unknown) => {
    return deps.snapshot(typeof limit === 'number' && Number.isFinite(limit) ? limit : 50)
  })

  deps.handle('wraith:activityCancel', async (_event, value: unknown): Promise<ActivityCancelResult> => {
    if (!isActivityCancelTarget(value)) return { ok: false, message: '无效的活动项' }

    const item = activeActivity(deps.snapshot(100), value)
    if (!item) return { ok: false, message: '活动项不存在或已结束' }
    if (!sourceId(item)) {
      const labels: Record<ActivityKind, string> = { session: '会话', task: '任务', automation: '自动化运行' }
      return { ok: false, message: `活动项缺少${labels[item.kind]}标识` }
    }

    try {
      switch (item.kind) {
      case 'session':
        if (item.sessionId !== deps.currentSessionId()) return { ok: false, message: '只能停止当前会话' }
        return cancelResult(await deps.request('turn.interrupt', deps.sessionInterruptParams(item)))
      case 'task':
        return cancelResult(await deps.request('task.cancel', { id: item.taskId! }))
      case 'automation':
        return { ok: false, message: '自动化运行暂不支持从活动中心停止' }
      }
    } catch (error) {
      return failure(error)
    }
  })
}
