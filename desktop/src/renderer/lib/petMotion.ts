import type { PetMotionStyle, PetState, PetView } from '../../shared/pets'
import { TRANSIENT_MS } from './petState'

export interface PetMotion {
  className: string
  durationMs: number
}

// 精灵表按状态分行取帧的固定行序;仅决定读哪一行,不影响 CSS 的 pet-* keyframes。
const SPRITE_STATE_ROWS: PetState[] = ['idle', 'thinking', 'tool', 'approval', 'success', 'error']

/**
 * 精灵包"行不存在时回退 idle,而不拒绝整个包"(spec §精灵包)的纯函数实现。
 * 越界状态(sprite.rows 小于该状态在固定行序里的下标)一律回退到第 0 行(idle),
 * 绝不用取模——取模会让越界状态 alias 撞到别的、存在的行(如 rows=3 时 approval%3
 * 撞 idle 行、success%3 撞 thinking 行),那不是"回退 idle",是读错了别的状态的帧。
 */
export function spriteRowFor(state: PetState, rows: number): number {
  const idx = SPRITE_STATE_ROWS.indexOf(state)
  return idx >= 0 && idx < rows ? idx : 0
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
  if (state === 'success') return { className: 'pet-success', durationMs: TRANSIENT_MS.success }
  if (state === 'error') return { className: 'pet-error', durationMs: TRANSIENT_MS.error }
  if (state === 'tool') return { className: 'pet-tool', durationMs: 900 }
  if (state === 'thinking') return { className: style === 'lively' ? 'pet-thinking-lively' : 'pet-thinking', durationMs: 1400 }
  if (state === 'approval') return { className: 'pet-approval', durationMs: 1800 }
  return { className: style === 'float' ? 'pet-idle-float' : 'pet-idle', durationMs: 2200 }
}
