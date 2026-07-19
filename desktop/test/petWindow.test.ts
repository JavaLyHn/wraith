import { describe, it, expect } from 'vitest'
import { isOpaqueAt, stepScale, clampToDisplay, defaultPetPosition, buildPetMenuTemplate } from '../src/shared/petWindow'
import type { PetView } from '../src/shared/pets'

describe('isOpaqueAt', () => {
  const w = 2 // 2x2 RGBA;像素(1,0)不透明,其余透明
  const data = new Uint8ClampedArray([0,0,0,0, 9,9,9,200, 0,0,0,0, 0,0,0,10])
  it('阈值上判命中', () => {
    expect(isOpaqueAt(data, w, 1, 0, 16)).toBe(true)
    expect(isOpaqueAt(data, w, 0, 0, 16)).toBe(false)
    expect(isOpaqueAt(data, w, 1, 1, 16)).toBe(false) // alpha 10 < 16
  })
  it('越界安全返回 false', () => {
    expect(isOpaqueAt(data, w, 5, 5, 16)).toBe(false)
    expect(isOpaqueAt(data, w, -1, 0, 16)).toBe(false)
  })
})

describe('stepScale', () => {
  it('deltaY>0 缩小、<0 放大,夹到 [0.5,2.0]', () => {
    expect(stepScale(1, -100)).toBeCloseTo(1.1)
    expect(stepScale(1, 100)).toBeCloseTo(0.9)
    expect(stepScale(0.5, 100)).toBe(0.5)
    expect(stepScale(2.0, -100)).toBe(2.0)
  })
})

describe('clampToDisplay', () => {
  const wa = { x: 0, y: 0, width: 1000, height: 800 }
  it('夹进工作区', () => {
    expect(clampToDisplay({ x: -50, y: -50, width: 100, height: 100 }, wa)).toMatchObject({ x: 0, y: 0 })
    expect(clampToDisplay({ x: 2000, y: 2000, width: 100, height: 100 }, wa)).toMatchObject({ x: 900, y: 700 })
  })
  it('多屏偏移工作区(x/y 非 0)也正确', () => {
    expect(clampToDisplay({ x: 100, y: 100, width: 100, height: 100 }, { x: 1000, y: 0, width: 1000, height: 800 }))
      .toMatchObject({ x: 1000, y: 100 })
  })
})

describe('defaultPetPosition', () => {
  it('落工作区右下角内(留 margin)', () => {
    expect(defaultPetPosition({ x: 0, y: 0, width: 1000, height: 800 }, { width: 200, height: 220 }, 24))
      .toEqual({ x: 1000 - 200 - 24, y: 800 - 220 - 24 })
  })
})

describe('buildPetMenuTemplate', () => {
  const pets: PetView[] = [
    { id: 'a', displayName: 'A', description: '', source: 'built-in', kind: 'static', available: true, removable: false, previewUrl: null, sprite: null },
    { id: 'b', displayName: 'B', description: '', source: 'imported', kind: 'static', available: false, removable: true, previewUrl: null, sprite: null },
  ]
  it('含选择宠物(仅可用打勾)/缩放/重置/关闭', () => {
    const t = buildPetMenuTemplate(pets, { selectedId: 'a', scale: 1 })
    const flat = JSON.stringify(t)
    expect(flat).toContain('pet:close')
    expect(flat).toContain('pet:reset-position')
    const select = t.find(i => i.id === 'pet:select')!
    expect(select.submenu!.find(s => s.id === 'pet:select:a')!.checked).toBe(true)
    // 不可用的 b 不在子菜单里
    expect(select.submenu!.find(s => s.id === 'pet:select:b')).toBeUndefined()
    const scale = t.find(i => i.id === 'pet:scale')!
    expect(scale.submenu!.some(s => s.id === 'pet:scale:1')).toBe(true)
  })
})
