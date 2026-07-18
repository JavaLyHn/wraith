import type { PetState } from '../../shared/pets'
import type { BackendEvent } from '../../shared/types'

export interface PetStateSignal {
  state: PetState
  transient: boolean
}

export function petStateFromEvent(event: BackendEvent): PetStateSignal | null {
  if (event.kind !== 'notification') return null

  switch (event.method) {
    case 'turn.started':
    case 'thinking.begin':
      return { state: 'thinking', transient: false }
    case 'tool.call':
    case 'tool.output.delta':
      return { state: 'tool', transient: false }
    case 'tool.result': {
      const ok = typeof event.params === 'object' && event.params !== null
        ? (event.params as { ok?: unknown }).ok
        : undefined
      if (typeof ok === 'boolean') return { state: 'thinking', transient: false }
      return null
    }
    case 'approval.requested':
    case 'plan.review.requested':
      return { state: 'approval', transient: false }
    case 'turn.completed':
      return { state: 'success', transient: true }
    case 'turn.failed':
      return { state: 'error', transient: true }
    default:
      return null
  }
}

export function nextPetState(signal: { state: PetState; expiresAt: number | null }, now: number): PetState {
  return signal.expiresAt !== null && now >= signal.expiresAt ? 'idle' : signal.state
}
