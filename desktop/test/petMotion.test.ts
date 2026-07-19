import { describe, expect, it } from 'vitest'
import { detectFrameCounts, motionFor, selectedPet, spriteRowFor } from '../src/renderer/lib/petMotion'
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
  })

  it('为等待确认和普通待机提供各自的稳定动作', () => {
    expect(motionFor('approval', 'calm', false)).toEqual({ className: 'pet-approval', durationMs: 1800 })
    expect(motionFor('idle', 'calm', false)).toEqual({ className: 'pet-idle', durationMs: 2200 })
  })
})

describe('spriteRowFor', () => {
  it('按 spec §状态映射表映射到 Petdex 行序(idle/wave/run/failed/review/jump)', () => {
    // Petdex 兼容布局行号:idle=0、wave=1、run=2、failed=3、review=4、jump=5。
    expect(spriteRowFor('idle', 9)).toBe(0) // idle
    expect(spriteRowFor('thinking', 9)).toBe(1) // wave——让"思考/工作中"可见,区别于 idle
    expect(spriteRowFor('tool', 9)).toBe(2) // run
    expect(spriteRowFor('approval', 9)).toBe(4) // review
    expect(spriteRowFor('success', 9)).toBe(5) // jump
    expect(spriteRowFor('error', 9)).toBe(3) // failed
  })

  it('行数不足时越界状态回退到 idle 行(0),不取模去撞别的、存在的行', () => {
    // rows=3 只够 idle(0)/wave(1)/run(2) 落在范围内。
    // approval(4)/success(5)/error(3) 的物理行号越界,取模会让它们各自撞到别的、
    // 存在的行(如 error 3%3=0、success 5%3=2 撞 run)——这里必须全部落回 0,不能取模。
    expect(spriteRowFor('approval', 3)).toBe(0)
    expect(spriteRowFor('success', 3)).toBe(0)
    expect(spriteRowFor('error', 3)).toBe(0)
    // 行内状态不受越界回退影响,仍取各自本来的行
    expect(spriteRowFor('idle', 3)).toBe(0)
    expect(spriteRowFor('thinking', 3)).toBe(1) // wave 在 rows=3 界内
    expect(spriteRowFor('tool', 3)).toBe(2)
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
  // 数据取自真实 Noir 精灵表逐格 alpha 采样:idle 6 / wave 8 / run 8 / failed 4 / review 5 / jump 8。
  it('取每行最后一个非空列+1 作为真实帧数,丢弃尾部透明列', () => {
    const grid = [
      [true, true, true, true, true, true, false, false], // idle: 6
      [true, true, true, true, true, true, true, true],    // wave: 8
      [true, true, true, true, true, true, true, true],    // run: 8
      [true, true, true, true, false, false, false, false], // failed: 4
      [true, true, true, true, true, false, false, false], // review: 5
      [true, true, true, true, true, true, true, true],    // jump: 8
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
