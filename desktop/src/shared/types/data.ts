/** Memory entries, snapshots, durable tasks, activity timeline. */

export interface MemoryEntryView {
  id: string
  content: string
  scope: string // 'project' | 'global'
  type: string  // MemoryEntry.MemoryType 枚举名(FACT/CONVERSATION/…)
  timestampMs: number
  tokenCount: number
}

export interface MemoryListResult {
  project: string
  entries: MemoryEntryView[]
  wraithMdExists?: boolean
  wraithMdPath?: string
}

/** 待确认候选记忆视图(AppServer memory.pendingList 回包 pending[])。 */
export interface PendingFactView {
  id: string
  fact: string
  type: string
  scope: string // 'project' | 'global'
  nearestExistingId: string | null
  sourceSessionId: string
  project: string | null
  createdAt: string
}

export interface PendingListResult {
  project: string
  pending: PendingFactView[]
}

/** memory.extractNow 回包:本次扫描入队的候选数。 */
export interface ExtractNowResult {
  enqueued: number
}

/** WRAITH.md 生成结果(AppServer memory.initProject 回包)。 */
export interface ProjectMemoryInitResult {
  written: boolean
  path: string
  message: string
}

/** side-git 快照条目视图(AppServer snapshot.* 回包)。 */
export interface SnapshotEntryView {
  commitId: string
  shortId: string
  phase: string // PRE_TURN | POST_TURN | PRE_RESTORE
  turnId: string
  summary: string
  createdAtMs: number
  preTurnOffset: number // >0 表示可恢复的 pre-turn 快照(其 restore offset);0 = 非 pre-turn
}

export interface SnapshotListResult {
  enabled: boolean
  snapshots: SnapshotEntryView[]
}

/** 后台任务视图(AppServer task.* 回包)。 */
export interface DurableTaskView {
  id: string
  status: string // enqueued | running | completed | failed | canceled
  prompt: string
  createdAtMs: number
  durationMs: number
  result?: string
  error?: string | null
  found?: boolean
}
export interface TaskListResult {
  enabled: boolean
  tasks: DurableTaskView[]
  error?: string
}

// ---------------------------------------------------------------------------
// Activity center: local sessions, durable tasks, and automation runs
// ---------------------------------------------------------------------------

export type ActivityKind = 'session' | 'task' | 'automation'

export type ActivityStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted'
  | 'unknown'

/** Read-only Git context resolved for an activity's own project path. */
export interface ActivityGitContext {
  branch: string | null
  worktree: string
  changedFiles: number
  additions: number
  deletions: number
  error?: string
}

/** A normalized local activity record consumed by the desktop activity center. */
export interface ActivityItem {
  activityId: string
  kind: ActivityKind
  status: ActivityStatus
  projectPath: string
  sessionId?: string
  taskId?: string
  runId?: string
  title?: string
  summary?: string
  branch?: string
  worktree?: string
  git?: ActivityGitContext
  startedAt: number
  updatedAt: number
  error?: string
  stale?: boolean
}

export interface ActivitySnapshot {
  activities: ActivityItem[]
  stale: boolean
  error?: string
}

/** Renderer input for the narrow activity cancellation IPC. */
export interface ActivityCancelRequest {
  kind: ActivityKind
  id: string
}

export interface ActivityCancelResult {
  ok: boolean
  message?: string
}

export interface SnapshotRestoreResult {
  ok: boolean
  message: string
  commitId: string
  restoredCount: number
  removedCount: number
}
