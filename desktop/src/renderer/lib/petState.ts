import type { PetState } from '../../shared/pets'
import type { BackendEvent } from '../../shared/types'

export interface PetStateSignal {
  state: PetState
  transient: boolean
}

// 瞬态状态过期时长的唯一来源——App.tsx(applyPetSignal 排 setTimeout)与
// petMotion.ts(motionFor 的 pet-success/pet-error CSS 动画时长)都引用这里,
// 避免两处硬编码 560/420 各自漂移。
export const TRANSIENT_MS = { success: 560, error: 420 } as const

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
