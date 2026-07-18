import { describe, expect, it } from 'vitest'
import { nextPetState, petStateFromEvent } from '../src/renderer/lib/petState'
import type { BackendEvent } from '../src/shared/types'

function notification(method: string, params: unknown = {}): BackendEvent {
  return { kind: 'notification', method, params }
}

describe('petStateFromEvent', () => {
  it('maps active turn notifications without exposing their parameters', () => {
    expect(petStateFromEvent(notification('turn.started', { secret: 'do-not-show' }))).toEqual({ state: 'thinking', transient: false })
    expect(petStateFromEvent(notification('thinking.begin', { label: 'private thought' }))).toEqual({ state: 'thinking', transient: false })
    expect(petStateFromEvent(notification('tool.call', { name: 'read_file', argsJson: '/secret' }))).toEqual({ state: 'tool', transient: false })
    expect(petStateFromEvent(notification('approval.requested', { argsJson: '/secret' }))).toEqual({ state: 'approval', transient: false })
    expect(petStateFromEvent(notification('plan.review.requested', { plan: 'private plan' }))).toEqual({ state: 'approval', transient: false })
  })

  it('maps completed and failed turns to transient states without payload text', () => {
    expect(petStateFromEvent(notification('turn.completed', { summary: 'private result' }))).toEqual({ state: 'success', transient: true })
    expect(petStateFromEvent(notification('turn.failed', { error: 'private error' }))).toEqual({ state: 'error', transient: true })
  })

  it('returns to tool state when an approved tool starts producing output', () => {
    expect(petStateFromEvent(notification('approval.requested', { argsJson: '/secret' }))).toEqual({ state: 'approval', transient: false })
    expect(petStateFromEvent(notification('tool.output.delta', { output: 'private output' }))).toEqual({ state: 'tool', transient: false })
    expect(petStateFromEvent(notification('tool.result', { output: 'private result' }))).toEqual({ state: 'tool', transient: false })
  })

  it('ignores connection events and unrelated notifications', () => {
    expect(petStateFromEvent({ kind: 'connection', state: 'connected' })).toBeNull()
    expect(petStateFromEvent(notification('message.delta', { text: 'private text' }))).toBeNull()
  })
})

describe('nextPetState', () => {
  it('keeps an active state before its expiry', () => {
    expect(nextPetState({ state: 'success', expiresAt: 1_000 }, 999)).toBe('success')
  })

  it('returns to idle once a transient state expires', () => {
    expect(nextPetState({ state: 'error', expiresAt: 1_000 }, 1_000)).toBe('idle')
  })

  it('keeps a persistent state without an expiry', () => {
    expect(nextPetState({ state: 'tool', expiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe('tool')
  })
})
