import type {
  ActivityItem,
  ActivitySnapshot,
  ActivityStatus,
  AutomationRun,
  DurableTaskView,
} from '../shared/types'

export interface SessionActivityInput {
  sessionId: string
  projectPath: string
  title?: string
  summary?: string
  branch?: string
  worktree?: string
  startedAt?: number
}

const MAX_RECENT_ITEMS = 100

/** Maps only the app-server notifications which are terminal/activity state changes. */
export function sessionStatusForNotification(method: string): ActivityStatus | undefined {
  switch (method) {
    case 'approval.requested':
    case 'choice.requested':
    case 'plan.review.requested': return 'waiting'
    case 'turn.completed':
    case 'message.done': return 'completed'
    case 'turn.failed':
    case 'turn.error':
    case 'error': return 'failed'
    default: return undefined
  }
}

/** `task.cancel` returns an acknowledgement, unlike task.get/list. */
export function isDurableTaskSnapshot(value: unknown): value is DurableTaskView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { status?: unknown }).status === 'string'
}

/** A persisted id may only replace the active temporary id for the same turn. */
export function shouldPromoteSessionIdentity(
  currentSessionId: string | null,
  currentTurnId: string | null,
  reportedSessionId: string,
  reportedTurnId: string | null,
): boolean {
  return !!currentSessionId
    && currentSessionId.startsWith('sess_')
    && currentSessionId !== reportedSessionId
    && !!currentTurnId
    && currentTurnId === reportedTurnId
}

function taskStatus(status: DurableTaskView['status']): ActivityStatus {
  switch (status) {
    case 'enqueued':
    case 'running': return 'running'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'canceled': return 'canceled'
    default: return 'unknown'
  }
}

function automationStatus(status: AutomationRun['status']): ActivityStatus {
  switch (status) {
    case 'running': return 'running'
    case 'waiting_approval': return 'waiting'
    case 'success': return 'completed'
    case 'failed': return 'failed'
    case 'interrupted': return 'interrupted'
    default: return 'unknown'
  }
}

/**
 * The main process owns this short-lived registry so the UI only consumes one
 * normalized shape. It deliberately receives live events/snapshots instead of
 * enumerating historic sessions as though they were active work.
 */
export class ActivityStore {
  private readonly items = new Map<string, ActivityItem>()
  private stale = false
  private error: string | undefined

  registerSession(input: SessionActivityInput): ActivitySnapshot {
    const now = Date.now()
    return this.replace({
      activityId: `session:${input.sessionId}`,
      kind: 'session',
      status: 'running',
      projectPath: input.projectPath,
      sessionId: input.sessionId,
      title: input.title,
      summary: input.summary,
      branch: input.branch,
      worktree: input.worktree,
      startedAt: input.startedAt ?? now,
      updatedAt: now,
    })
  }

  updateSession(id: string, patch: Partial<Omit<ActivityItem, 'activityId' | 'kind' | 'sessionId' | 'startedAt'>>): ActivitySnapshot {
    const activityId = `session:${id}`
    const existing = this.items.get(activityId)
    if (!existing) return this.snapshot(MAX_RECENT_ITEMS)
    return this.replace({ ...existing, ...patch, updatedAt: patch.updatedAt ?? Date.now(), stale: false })
  }

  /** Replace the temporary wire id when the backend persists the active session. */
  promoteSession(fromId: string, toId: string): ActivitySnapshot {
    if (fromId === toId) return this.snapshot(MAX_RECENT_ITEMS)
    const previous = this.items.get(`session:${fromId}`)
    if (!previous) return this.snapshot(MAX_RECENT_ITEMS)
    this.items.delete(previous.activityId)
    return this.replace({
      ...previous,
      activityId: `session:${toId}`,
      sessionId: toId,
      updatedAt: Date.now(),
    })
  }

  registerTask(task: DurableTaskView): ActivitySnapshot {
    const now = Date.now()
    return this.replaceOrKeepTimestamp({
      activityId: `task:${task.id}`,
      kind: 'task',
      status: taskStatus(task.status),
      projectPath: '',
      taskId: task.id,
      title: task.prompt,
      summary: task.result,
      startedAt: task.createdAtMs,
      updatedAt: task.createdAtMs + task.durationMs || now,
      error: task.error ?? undefined,
    })
  }

  registerAutomation(run: AutomationRun): ActivitySnapshot {
    return this.replaceOrKeepTimestamp({
      activityId: `automation:${run.runId}`,
      kind: 'automation',
      status: automationStatus(run.status),
      projectPath: '',
      runId: run.runId,
      sessionId: run.sessionId,
      title: run.taskId,
      summary: run.summary,
      startedAt: run.startedAt,
      updatedAt: run.endedAt ?? Date.now(),
    })
  }

  mergeSnapshot(sourceItems: ActivityItem[]): ActivitySnapshot {
    for (const item of sourceItems) this.items.set(item.activityId, { ...item, stale: false })
    this.clearStale()
    this.trim()
    return this.snapshot(MAX_RECENT_ITEMS)
  }

  snapshot(limit: number): ActivitySnapshot {
    const activities = [...this.items.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit))
      .map(item => ({ ...item }))
    return { activities, stale: this.stale, ...(this.error ? { error: this.error } : {}) }
  }

  markStale(reason: string): ActivitySnapshot {
    for (const [id, item] of this.items) {
      const status = item.kind === 'session'
        ? item.status === 'running' ? 'interrupted' : item.status === 'waiting' ? 'unknown' : item.status
        : item.status
      this.items.set(id, { ...item, status, updatedAt: Date.now(), stale: true, error: reason })
    }
    this.stale = true
    this.error = reason
    return this.snapshot(MAX_RECENT_ITEMS)
  }

  /** A failed source refresh must not make unrelated sources appear stale. */
  markSourceStale(kind: ActivityItem['kind'], reason: string): ActivitySnapshot {
    let changed = false
    for (const [id, item] of this.items) {
      if (item.kind !== kind) continue
      changed = true
      this.items.set(id, { ...item, stale: true, error: reason })
    }
    if (changed) {
      this.stale = true
      this.error = reason
    }
    return this.snapshot(MAX_RECENT_ITEMS)
  }

  private replace(item: ActivityItem): ActivitySnapshot {
    this.items.set(item.activityId, item)
    this.clearStale()
    this.trim()
    return this.snapshot(MAX_RECENT_ITEMS)
  }

  /** 轮询重复拿到同一条来源记录时保留更新时间，避免无变化的 UI 推送。 */
  private replaceOrKeepTimestamp(item: ActivityItem): ActivitySnapshot {
    const previous = this.items.get(item.activityId)
    if (previous) {
      const { updatedAt: _previousUpdatedAt, stale: _previousStale, ...previousComparable } = previous
      const { updatedAt: _nextUpdatedAt, stale: _nextStale, ...nextComparable } = item
      if (!this.stale && !previous.stale && JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
        return this.snapshot(MAX_RECENT_ITEMS)
      }
    }
    return this.replace(item)
  }

  private clearStale(): void {
    const staleItems = [...this.items.values()].filter(item => item.stale)
    this.stale = staleItems.length > 0
    this.error = staleItems.find(item => item.error)?.error
  }

  private trim(): void {
    const terminal = [...this.items.values()]
      .filter(item => !['running', 'waiting'].includes(item.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    for (const item of terminal.slice(MAX_RECENT_ITEMS)) this.items.delete(item.activityId)
  }
}
