import { describe, it, expect } from 'vitest'
import { isOpaqueAt, stepScale, clampToDisplay, defaultPetPosition, buildPetMenuTemplate, spriteHitPixel, containScale } from '../src/shared/petWindow'
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

describe('spriteHitPixel', () => {
  it('scale=1 时,窗口像素 = 当前帧内偏移,直接反算 sheet 像素(col/row 换算成整格偏移)', () => {
    expect(spriteHitPixel(50, 60, 1, 2, 3, 192, 208)).toEqual({ px: 2 * 192 + 50, py: 3 * 208 + 60 })
  })
  it('scale≠1 时按 scale 缩放反算(除法),并向下取整', () => {
    // frameW=frameH=10,scale=3,col=row=0:clientX=7 → 7/3=2.333→floor=2
    expect(spriteHitPixel(7, 7, 3, 0, 0, 10, 10)).toEqual({ px: 2, py: 2 })
    // col=2 时整格偏移仍是整数像素,不受 scale 影响
    expect(spriteHitPixel(9, 0, 2, 2, 0, 10, 10)).toEqual({ px: 2 * 10 + 4, py: 0 })
  })
  it('落在精灵盒(frameW*scale × frameH*scale)之外(含右/下 PAD 死区)→ null,而非误采邻格像素', () => {
    // scale=1,frameW=192 → 盒宽 192,clientX=192 已经出盒(边界排它性 [0,boxW))
    expect(spriteHitPixel(192, 0, 1, 0, 0, 192, 208)).toBeNull()
    expect(spriteHitPixel(0, 208, 1, 0, 0, 192, 208)).toBeNull()
    expect(spriteHitPixel(191, 207, 1, 0, 0, 192, 208)).not.toBeNull() // 盒内边界像素仍算命中
  })
  it('负坐标 / scale<=0 → null(安全兜底,视为透明穿透)', () => {
    expect(spriteHitPixel(-1, 0, 1, 0, 0, 192, 208)).toBeNull()
    expect(spriteHitPixel(0, -1, 1, 0, 0, 192, 208)).toBeNull()
    expect(spriteHitPixel(0, 0, 0, 0, 0, 192, 208)).toBeNull()
    expect(spriteHitPixel(0, 0, -1, 0, 0, 192, 208)).toBeNull()
  })
})

describe('containScale', () => {
  it('超出 maxPx 的一侧按等比收缩(取更小的那个比例)', () => {
    expect(containScale(300, 200, 112)).toBeCloseTo(112 / 300)
  })
  it('两侧都不超 maxPx → 不放大,原样 1', () => {
    expect(containScale(50, 40, 112)).toBe(1)
  })
  it('非正宽高/maxPx → 兜底 1(防除零)', () => {
    expect(containScale(0, 40, 112)).toBe(1)
    expect(containScale(50, 0, 112)).toBe(1)
    expect(containScale(50, 40, 0)).toBe(1)
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
