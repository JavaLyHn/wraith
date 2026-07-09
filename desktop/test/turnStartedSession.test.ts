import { describe, it, expect } from 'vitest'
import { reduce, freshState } from '../src/shared/transcriptReducer'
import type { BackendEvent } from '../src/shared/types'

function ev(method: string, params: Record<string, unknown>): BackendEvent {
  return { kind: 'notification', method, params } as BackendEvent
}

describe('turn.started carries sessionId (backend early-persist)', () => {
  it('sets sessionId from turn.started params when non-empty', () => {
    let s = freshState()
    s = reduce(s, ev('turn.started', { sessionId: '20260709-abcd', turnId: 't1' }))
    expect(s.turn).toBe('running')
    expect(s.sessionId).toBe('20260709-abcd')
  })

  it('leaves existing sessionId untouched when turn.started sessionId is empty', () => {
    let s = freshState()
    s = reduce(s, ev('turn.started', { sessionId: 'sess-1', turnId: 't1' }))
    s = reduce(s, ev('turn.completed', { sessionId: 'sess-1', turnId: 't1', status: 'completed' }))
    // a later turn.started with no sessionId must not blank it out
    s = reduce(s, ev('turn.started', { turnId: 't2' }))
    expect(s.turn).toBe('running')
    expect(s.sessionId).toBe('sess-1')
  })
})
