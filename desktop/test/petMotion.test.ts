import { describe, expect, it } from 'vitest'
import { detectFrameCounts, motionFor, selectedPet, spriteRowFor, RUN_RIGHT_ROW, RUN_LEFT_ROW } from '../src/renderer/lib/petMotion'
import type { PetView } from '../src/shared/pets'

describe('motionFor', () => {
  it('在减少动态效果或静态风格时不提供动画', () => {
    expect(motionFor('tool', 'static', false)).toEqual({ className: '', durationMs: 0 })
    expect(motionFor('success', 'calm', true)).toEqual({ className: '', durationMs: 0 })
  })

  it('为短暂结果和工具状态提供确定的动画', () => {
    expect(motionFor('success', 'calm', false)).toEqual({ className: 'pet-success', durationMs: 560 })
    expect(motionFor('error', 'float', false)).toEqual({ className: 'pet-error', durationMs: 420 })
    expect(motionFor('tool', 'lively', false)).toEqual({ className: 'pet-tool', durationMs: 900 })
  })

  it('仅让活泼风格使用活泼思考动作，并为浮动风格提供浮动待机', () => {
    expect(motionFor('thinking', 'lively', false)).toEqual({ className: 'pet-thinking-lively', durationMs: 1400 })
    expect(motionFor('thinking', 'float', false)).toEqual({ className: 'pet-thinking', durationMs: 1400 })
    expect(motionFor('idle', 'float', false)).toEqual({ className: 'pet-idle-float', durationMs: 2200 })
    // 活泼 idle 用更欢快的弹跳(独立类 + 更快节拍),明显区别于克制的 pet-idle
    expect(motionFor('idle', 'lively', false)).toEqual({ className: 'pet-idle-lively', durationMs: 1100 })
  })

  it('为等待确认和普通待机提供各自的稳定动作', () => {
    expect(motionFor('approval', 'calm', false)).toEqual({ className: 'pet-approval', durationMs: 1800 })
    expect(motionFor('idle', 'calm', false)).toEqual({ className: 'pet-idle', durationMs: 2200 })
  })
})

describe('spriteRowFor', () => {
  it('按 Noir 真实行语义映射(0 Idle/3 Waving/7 Running/8 Review/4 Jumping/5 Failed)', () => {
    // 真实 Noir 9 行:0 Idle,1 RunRight,2 RunLeft,3 Waving,4 Jumping,5 Failed,
    // 6 Waiting,7 Running,8 Review(经真机核对,非早期 spec 假设的 idle/wave/run/…)。
    expect(spriteRowFor('idle', 9)).toBe(0) // Idle
    expect(spriteRowFor('thinking', 9)).toBe(3) // Waving——思考/生成中,可见区别 idle
    expect(spriteRowFor('tool', 9)).toBe(7) // Running——执行工具/命令
    expect(spriteRowFor('approval', 9)).toBe(8) // Review——等待确认/审批
    expect(spriteRowFor('success', 9)).toBe(4) // Jumping——成功欢跳
    expect(spriteRowFor('error', 9)).toBe(5) // Failed——失败
  })

  it('拖动方向奔跑的规范行常量:Run Right=1、Run Left=2', () => {
    expect(RUN_RIGHT_ROW).toBe(1)
    expect(RUN_LEFT_ROW).toBe(2)
  })

  it('行数不足时越界状态回退到 idle 行(0),不取模去撞别的、存在的行', () => {
    // rows=4 只够 0..3 落在范围内:idle(0)/thinking→Waving(3) 在界内;
    // tool→Running(7)/approval→Review(8)/success→Jumping(4)/error→Failed(5) 越界 → 全回落 0,
    // 绝不取模(取模会让 success 5%4=1 撞 RunRight、error 5%4=1 等,读错别的行)。
    expect(spriteRowFor('idle', 4)).toBe(0)
    expect(spriteRowFor('thinking', 4)).toBe(3) // Waving 在 rows=4 界内
    expect(spriteRowFor('tool', 4)).toBe(0)
    expect(spriteRowFor('approval', 4)).toBe(0)
    expect(spriteRowFor('success', 4)).toBe(0)
    expect(spriteRowFor('error', 4)).toBe(0)
  })
})

describe('selectedPet', () => {
  const noirAvailable: PetView = {
    id: 'noir-webling', displayName: 'Noir Webling', description: '', source: 'petdex', kind: 'spritesheet',
    available: true, removable: false, previewUrl: null, sprite: { columns: 8, rows: 9, frameWidth: 192, frameHeight: 208 },
  }
  const noirUnavailable: PetView = { ...noirAvailable, available: false }
  const builtIn: PetView = {
    id: 'wraith-companion', displayName: 'Wraith Companion', description: '', source: 'built-in', kind: 'static',
    available: true, removable: false, previewUrl: null, sprite: null,
  }

  it('不选中未安装的 Noir，即便它是显式选中项，转而回退列表中第一个可用宠物', () => {
    expect(selectedPet([noirUnavailable, builtIn], 'noir-webling')).toEqual(builtIn)
    expect(selectedPet([noirUnavailable], 'noir-webling')).toBeNull()
  })

  it('无 selectedId 时回退到第一个可用宠物,不要求来源为内置——与桌宠窗口 assemblePetPreview 的回退口径对齐', () => {
    // 这正是本次要修的分歧本身:此前该函数的回退分支硬性要求 source==='built-in',
    // 而桌宠窗口那边回退的是"任意来源的第一个可用宠物"——两边不一致时,设置页会显示
    // "未选择",桌面却已经在展示一只自动识别到的 petdex 宠物。
    expect(selectedPet([noirAvailable], null)).toEqual(noirAvailable)
  })

  it('已检测到且可用的 Noir 选择跨刷新（新的宠物数组引用）保留', () => {
    const beforeRefresh = selectedPet([noirAvailable, builtIn], 'noir-webling')
    expect(beforeRefresh).toEqual(noirAvailable)

    // 模拟一次库刷新:新的数组/对象引用,但选中 id 不变
    const afterRefresh = selectedPet([{ ...noirAvailable }, { ...builtIn }], 'noir-webling')
    expect(afterRefresh).toEqual(noirAvailable)
  })

  it('无匹配且无可用内置宠物时返回 null', () => {
    expect(selectedPet([], null)).toBeNull()
    expect(selectedPet([{ ...builtIn, available: false }], null)).toBeNull()
  })
})

describe('detectFrameCounts', () => {
  // Petdex 精灵表是固定网格 + 透明列补齐:每行真实帧数 = 最后一个非空列 + 1,
  // 尾部透明列不能被当成帧循环,否则动画会周期性停在空白格 → 宠物"消失一段时间"。
  // 数据取自真实 Noir 精灵表逐格 alpha 采样(行 0-5):Idle 6 / RunRight 8 / RunLeft 8 /
  // Waving 4 / Jumping 5 / Failed 8(帧数与后 3 行 Waiting6/Running6/Review6 见真机图)。
  it('取每行最后一个非空列+1 作为真实帧数,丢弃尾部透明列', () => {
    const grid = [
      [true, true, true, true, true, true, false, false], // Idle: 6
      [true, true, true, true, true, true, true, true],    // RunRight: 8
      [true, true, true, true, true, true, true, true],    // RunLeft: 8
      [true, true, true, true, false, false, false, false], // Waving: 4
      [true, true, true, true, true, false, false, false], // Jumping: 5
      [true, true, true, true, true, true, true, true],    // Failed: 8
    ]
    expect(detectFrameCounts(grid, 8)).toEqual([6, 8, 8, 4, 5, 8])
  })

  it('行内部空洞不截断,仍以最后一个非空列为准', () => {
    expect(detectFrameCounts([[true, false, true, false]], 8)).toEqual([3])
  })

  it('整行全空 → 至少 1 帧,绝不返回 0(避免除零/无帧)', () => {
    expect(detectFrameCounts([[false, false, false, false]], 8)).toEqual([1])
  })
})
