import type { PetMotionStyle, PetState, PetView } from '../../shared/pets'
import { TRANSIENT_MS } from '../../shared/petState'

export interface PetMotion {
  className: string
  durationMs: number
}

// Petdex 兼容精灵包的行序(spec §精灵包):idle、wave、run、failed、review、jump——
// 这是包本身的物理行号,与 PetState 的取名顺序无关。下表把 Wraith 状态映射到
// spec §状态映射表规定的那一行:tool→run、approval→review、success→jump、
// error→failed;thinking 没有专属行,回退 idle(0)。
const STATE_ROW: Record<PetState, number> = {
  idle: 0, // idle
  thinking: 0, // 无专属行→回退 idle
  tool: 2, // run
  approval: 4, // review
  success: 5, // jump
  error: 3, // failed
}

/**
 * 精灵包"行不存在时回退 idle,而不拒绝整个包"(spec §精灵包)的纯函数实现。
 * 越界状态(sprite.rows 小于该状态映射到的物理行号)一律回退到第 0 行(idle),
 * 绝不用取模——取模会让越界状态 alias 撞到别的、存在的行,那不是"回退 idle",
 * 是读错了别的状态的帧。
 */
export function spriteRowFor(state: PetState, rows: number): number {
  const row = STATE_ROW[state]
  return row < rows ? row : 0
}

/**
 * 纯函数解析当前应展示的宠物:优先偏好里记的 selectedId(须仍可用),
 * 否则回退到第一个可用的内置宠物;都没有则 null。
 * 不读取/写入任何偏好状态——选中项的持久化与跨刷新保留完全由调用方(经
 * usePetConfig 拿到的 config.selectedId)负责,这里只做无副作用的查找。
 */
export function selectedPet(pets: PetView[], selectedId: string | null): PetView | null {
  return pets.find(p => p.id === selectedId && p.available) ?? pets.find(p => p.source === 'built-in' && p.available) ?? null
}

/**
 * 从「逐格是否非空」的布尔网格推每行真实帧数:= 该行最后一个非空列 + 1。
 * Petdex 精灵表是固定网格(8×9),各动画帧数不一,尾部以透明列补齐——若帧循环
 * 无脑跑满 columns,循环到透明尾列时整只宠物就"消失一段时间"(idle 尤其明显,
 * 是默认静息态)。据此只循环真实帧。行全空回退 1 帧(绝不 0,防除零)。
 * 内部空洞不截断,以最后一个非空列为准。
 */
export function detectFrameCounts(nonEmpty: boolean[][], columns: number): number[] {
  return nonEmpty.map(cells => {
    let last = -1
    for (let c = 0; c < cells.length; c++) if (cells[c]) last = c
    return last >= 0 ? last + 1 : 1
  })
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
