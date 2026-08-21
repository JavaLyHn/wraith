import { describe, expect, it, vi } from 'vitest'
import { ActivityStore } from '../src/main/activityStore'
import { submitActivityTurn } from '../src/main/activitySubmission'
import { shouldPromoteSessionIdentity } from '../src/main/activityStore'
import type { ActivitySnapshot } from '../src/shared/types'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function deps(
  store: ActivityStore,
  request: (
    method: 'turn.submit',
    params: Record<string, unknown>,
    onResult?: (result: unknown) => void,
  ) => Promise<unknown>,
  sessionId = 'sess_temporary',
) {
  let turnId: string | null = 'previous-turn'
  let pendingTurnId: string | null = null
  return {
    store,
    currentSessionId: () => sessionId,
    currentProjectPath: () => 'D:/projects/wraith',
    request,
    setCurrentTurnId: (value: string | null) => { turnId = value },
    setPendingTurnId: (value: string | null) => { pendingTurnId = value },
    updateActivity: (mutation: () => ActivitySnapshot) => { mutation() },
    turnId: () => turnId,
    pendingTurnId: () => pendingTurnId,
  }
}

describe('activity submit lifecycle', () => {
  it('keeps a terminal session state when the terminal notification arrives before submit resolves', async () => {
    const pending = deferred<{ turnId: string; status: string }>()
    const store = new ActivityStore()
    const input = deps(store, (_method, _params, onResult) => {
      onResult?.({ turnId: 'turn-1', status: 'accepted' })
      return pending.promise
    })

    const submission = submitActivityTurn(input, '请完成这项工作')
    expect(input.pendingTurnId()).toBe('turn-1')
    expect(store.snapshot(10).activities).toEqual([
      expect.objectContaining({ activityId: 'session:sess_temporary', status: 'running' }),
    ])

    const reportedSessionId = '20260813T123000'
    expect(shouldPromoteSessionIdentity(
      'sess_temporary',
      input.turnId(),
      reportedSessionId,
      'turn-1',
      input.pendingTurnId(),
    )).toBe(true)
    input.updateActivity(() => store.promoteSession('sess_temporary', reportedSessionId))
    input.updateActivity(() => store.updateSession(reportedSessionId, { status: 'completed' }))
    pending.resolve({ turnId: 'turn-1', status: 'accepted' })

    await expect(submission).resolves.toEqual({ turnId: 'turn-1', status: 'accepted' })
    expect(input.turnId()).toBe('turn-1')
    expect(input.pendingTurnId()).toBeNull()
    expect(store.snapshot(10).activities).toEqual([
      expect.objectContaining({ activityId: 'session:20260813T123000', status: 'completed' }),
    ])
  })

  it('does not switch the temporary session for an unrelated terminal turn while submit is pending', () => {
    let currentSessionId = 'sess_temporary'
    const submittedTurnId = 'turn-submitted'
    const reportedSessionId = 'other-session'

    if (shouldPromoteSessionIdentity(
      currentSessionId,
      null,
      reportedSessionId,
      'turn-unrelated',
      submittedTurnId,
    )) {
      currentSessionId = reportedSessionId
    }

    expect(currentSessionId).toBe('sess_temporary')
  })

  it('rolls back an unresolved provisional row when turn submission fails', async () => {
    const store = new ActivityStore()
    const input = deps(store, vi.fn(async () => { throw new Error('backend unavailable') }))

    await expect(submitActivityTurn(input, '这次提交会失败')).rejects.toThrow('backend unavailable')
    expect(store.snapshot(10).activities).toEqual([])
    expect(input.turnId()).toBeNull()
    expect(input.pendingTurnId()).toBeNull()
  })
})
