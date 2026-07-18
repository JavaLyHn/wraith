import type { PetMotionStyle, PetState } from '../../shared/pets'

export interface PetMotion {
  className: string
  durationMs: number
}

export function motionFor(state: PetState, style: PetMotionStyle, reduced: boolean): PetMotion {
  if (reduced || style === 'static') return { className: '', durationMs: 0 }
  if (state === 'success') return { className: 'pet-success', durationMs: 560 }
  if (state === 'error') return { className: 'pet-error', durationMs: 420 }
  if (state === 'tool') return { className: 'pet-tool', durationMs: 900 }
  if (state === 'thinking') return { className: style === 'lively' ? 'pet-thinking-lively' : 'pet-thinking', durationMs: 1400 }
  if (state === 'approval') return { className: 'pet-approval', durationMs: 1800 }
  return { className: style === 'float' ? 'pet-idle-float' : 'pet-idle', durationMs: 2200 }
}
