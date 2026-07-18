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
    case 'tool.result':
      return { state: 'tool', transient: false }
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
