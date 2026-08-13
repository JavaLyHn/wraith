import type { ActivityItem, ActivitySnapshot } from '../shared/types'
import type { ActivityStore } from './activityStore'

type TurnMode = 'react' | 'plan' | 'team'

export interface ActivitySubmissionDependencies {
  store: ActivityStore
  currentSessionId(): string | null
  currentProjectPath(): string
  request(method: 'turn.submit', params: Record<string, unknown>): Promise<unknown>
  setCurrentTurnId(turnId: string | null): void
  setSubmissionPending(sessionId: string | null): void
  updateActivity(mutation: () => ActivitySnapshot): void
}

interface TurnSubmitResult {
  turnId: string
  status: string
}

function currentSessionActivity(store: ActivityStore, sessionId: string): ActivityItem | undefined {
  return store.snapshot(100).activities.find(item => item.activityId === `session:${sessionId}`)
}

/**
 * Registers a provisional row before the RPC can emit terminal notifications.
 * A rejected RPC restores the previous row so an unsent turn is never shown as running.
 */
export async function submitActivityTurn(
  deps: ActivitySubmissionDependencies,
  input: string,
  attachments?: { path: string; kind: string }[],
  mode: TurnMode = 'react',
): Promise<TurnSubmitResult> {
  const sessionId = deps.currentSessionId()
  const previous = sessionId ? currentSessionActivity(deps.store, sessionId) : undefined
  deps.setCurrentTurnId(null)
  deps.setSubmissionPending(sessionId)
  if (sessionId) {
    deps.updateActivity(() => deps.store.registerSession({
      sessionId,
      projectPath: deps.currentProjectPath(),
      title: input,
    }))
  }

  try {
    const result = await deps.request('turn.submit', {
      sessionId,
      input,
      ...(attachments?.length ? { attachments: attachments.map(attachment => ({ path: attachment.path, kind: attachment.kind })) } : {}),
      mode,
    }) as TurnSubmitResult
    deps.setCurrentTurnId(result.turnId)
    return result
  } catch (error) {
    if (sessionId) deps.updateActivity(() => deps.store.rollbackSessionSubmission(sessionId, previous))
    throw error
  } finally {
    deps.setSubmissionPending(null)
  }
}
