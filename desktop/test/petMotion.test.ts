import { describe, expect, it } from 'vitest'
import { motionFor, selectedPet } from '../src/renderer/lib/petMotion'
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
