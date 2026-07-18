import type { PetMotionStyle, PetState, PetView } from '../../shared/pets'

export interface PetMotion {
  className: string
  durationMs: number
}

/**
 * 纯函数解析当前应展示的宠物:优先偏好里记的 selectedId(须仍可用),
 * 否则回退到第一个可用的内置宠物;都没有则 null。
 * 不读取/写入任何偏好状态——选中项的持久化与跨刷新保留完全由调用方的
 * prefs.pets.selectedId 负责,这里只做无副作用的查找。
 */
export function selectedPet(pets: PetView[], selectedId: string | null): PetView | null {
  return pets.find(p => p.id === selectedId && p.available) ?? pets.find(p => p.source === 'built-in' && p.available) ?? null
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
