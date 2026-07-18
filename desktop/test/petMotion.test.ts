import { describe, expect, it } from 'vitest'
import { motionFor, selectedPet, spriteRowFor } from '../src/renderer/lib/petMotion'
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
    expect(spriteRowFor('thinking', 9)).toBe(0) // 无专属行→回退 idle
    expect(spriteRowFor('tool', 9)).toBe(2) // run
    expect(spriteRowFor('approval', 9)).toBe(4) // review
    expect(spriteRowFor('success', 9)).toBe(5) // jump
    expect(spriteRowFor('error', 9)).toBe(3) // failed
  })

  it('行数不足时越界状态回退到 idle 行(0),不取模去撞别的、存在的行', () => {
    // rows=3 只够 idle(0)/run(2) 落在范围内;wave(1)存在但没有状态映射到它。
    // approval(4)/success(5)/error(3) 的物理行号越界,取模会让它们各自撞到别的、
    // 存在的行(如 error 4%3=1 撞 wave)——这里必须全部落回 0,不能取模。
    expect(spriteRowFor('approval', 3)).toBe(0)
    expect(spriteRowFor('success', 3)).toBe(0)
    expect(spriteRowFor('error', 3)).toBe(0)
    // 行内状态不受越界回退影响,仍取各自本来的行
    expect(spriteRowFor('idle', 3)).toBe(0)
    expect(spriteRowFor('thinking', 3)).toBe(0)
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

  it('不选中未安装的 Noir，即便它是显式选中项，转而回退内置且可用的宠物', () => {
    expect(selectedPet([noirUnavailable, builtIn], 'noir-webling')).toEqual(builtIn)
    expect(selectedPet([noirUnavailable], 'noir-webling')).toBeNull()
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
