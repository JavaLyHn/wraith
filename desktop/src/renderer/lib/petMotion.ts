import type { PetMotionStyle, PetState, PetView } from '../../shared/pets'
import { TRANSIENT_MS } from '../../shared/petState'

export interface PetMotion {
  className: string
  durationMs: number
}

// Noir 精灵表的真实行语义(9 行,经真机核对,非早期 spec 假设的 idle/wave/run/failed/
// review/jump 序——那个假设错了,曾导致 success 播 Failed、error 播 Waving 等全盘错位):
//   0 Idle  1 RunRight  2 RunLeft  3 Waving  4 Jumping  5 Failed  6 Waiting  7 Running  8 Review
// 下表把 Wraith 运行状态映射到语义最贴的行(拖动方向奔跑另用 RUN_RIGHT_ROW/RUN_LEFT_ROW,
// 不经此表)。这套映射即 Wraith 认定的规范布局(Noir 是唯一参考 Petdex 宠物,其 manifest
// 未声明行语义,故以其实际布局为准;自制精灵包须按此行序,否则动画会错位)。
const STATE_ROW: Record<PetState, number> = {
  idle: 0,     // Idle——无活动
  thinking: 3, // Waving——模型思考/生成中,挥手示意"在忙",明显区别 idle(thinking 占 turn 主时段)
  tool: 7,     // Running——执行工具/命令,原地奔跑=正在干活
  approval: 8, // Review——等待用户确认/审批,审阅姿态
  success: 4,  // Jumping——turn 成功,欢跳
  error: 5,    // Failed——失败/报错
}

/** 拖动方向奔跑用的规范行:向右拖播 Run Right(1),向左拖播 Run Left(2)。
 * 精灵表本就分绘了左右两向奔跑帧,故直接用真行而非 scaleX 镜像(镜像是无左右行时的兜底)。 */
export const RUN_RIGHT_ROW = 1
export const RUN_LEFT_ROW = 2

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
 * 否则回退到列表中第一个可用宠物(不限来源)——与主进程宠物窗口
 * assemblePetPreview 的回退口径对齐,避免"桌面已经在展示某只宠物,设置页却显示
 * 未选择"的分歧;都没有可用宠物则 null。
 * 不读取/写入任何偏好状态——选中项的持久化与跨刷新保留完全由调用方(经
 * usePetConfig 拿到的 config.selectedId)负责,这里只做无副作用的查找。
 */
export function selectedPet(pets: PetView[], selectedId: string | null): PetView | null {
  return pets.find(p => p.id === selectedId && p.available) ?? pets.find(p => p.available) ?? null
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
