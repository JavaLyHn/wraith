import { describe, it, expect } from 'vitest'
import { loadPrefs, savePrefs, DEFAULT_PREFS, normalizePetPrefs } from '../src/renderer/settings/prefs'

describe('loadPrefs', () => {
  it('无存储 → 全默认', () => {
    expect(loadPrefs(() => null)).toEqual(DEFAULT_PREFS)
  })
  it('非法 JSON → 全默认', () => {
    expect(loadPrefs(() => '{not json')).toEqual(DEFAULT_PREFS)
  })
  it('部分字段 + 非法枚举 → 逐字段回落默认', () => {
    const raw = JSON.stringify({ ui: { theme: 'dark', accent: 'bogus', fontSize: 'lg' }, profile: { name: '阿豪' } })
    const p = loadPrefs(() => raw)
    expect(p.ui.theme).toBe('dark')            // 合法保留
    expect(p.ui.accent).toBe('teal')           // 非法回落
    expect(p.ui.fontSize).toBe('lg')
    expect(p.ui.fontFamily).toBe('system')     // 缺失回落
    expect(p.profile.name).toBe('阿豪')
    expect(p.profile.avatar).toBe('')
    expect(p.update).toEqual(DEFAULT_PREFS.update)
  })
  it('空昵称回落默认名', () => {
    expect(loadPrefs(() => JSON.stringify({ profile: { name: '   ' } })).profile.name).toBe('我')
  })

  it('补全旧偏好中的宠物默认值，同时保留有效宠物偏好', () => {
    expect(loadPrefs(() => JSON.stringify({
      pets: { enabled: true, selectedId: 'noir-webling', motion: 'float', scale: 1.2 },
    })).pets).toEqual({
      enabled: true,
      selectedId: 'noir-webling',
      motion: 'float',
      scale: 1.2,
      position: { x: 0, y: 0 },
    })
  })

  it('将非法宠物偏好和非有限位置回落为默认值(仅非有限值回落,有限坐标保留)', () => {
    // 位置上限已放宽为垃圾值过滤(±4096):-161 现在是合法偏移应保留,
    // 只有 Infinity/NaN 这类非有限值才回落 0。视觉边界另由 PetAvatar 实测夹。
    expect(loadPrefs(() => JSON.stringify({
      pets: {
        enabled: 'yes',
        selectedId: 123,
        motion: 'fast',
        scale: 1.6,
        position: { x: Infinity, y: -161 },
      },
    })).pets).toEqual({
      ...DEFAULT_PREFS.pets,
      position: { x: 0, y: -161 },
    })
  })

  it('保留任意真实窗口内的宠物位置(含远超旧 ±160 的上拖偏移)和缩放值', () => {
    expect(loadPrefs(() => JSON.stringify({
      pets: { enabled: false, scale: 1.5, position: { x: -900, y: -720 } },
    })).pets).toMatchObject({ enabled: false, scale: 1.5, position: { x: -900, y: -720 } })
  })

  it('将过小缩放和非有限位置回落默认,离谱大数(超 ±4096)也回落', () => {
    const raw = '{"pets":{"scale":0.74,"position":{"x":5000,"y":1e400}}}'
    expect(loadPrefs(() => raw).pets).toMatchObject({
      scale: DEFAULT_PREFS.pets.scale,
      position: { x: 0, y: 0 },
    })
  })
})

describe('savePrefs', () => {
  it('写整个 JSON 到 wraith.prefs,可被 loadPrefs 读回', () => {
    const store: Record<string, string> = {}
    const next = { ...DEFAULT_PREFS, ui: { ...DEFAULT_PREFS.ui, theme: 'dark' as const } }
    savePrefs(next, (k, v) => { store[k] = v })
    expect(store['wraith.prefs']).toBeTruthy()
    expect(loadPrefs((k) => store[k] ?? null)).toEqual(next)
  })
})

describe('normalizePetPrefs', () => {
  it('规范化运行时合并后的宠物偏好:非有限坐标回落 0,有限坐标(-200)保留,越界缩放回落', () => {
    expect(normalizePetPrefs({
      ...DEFAULT_PREFS.pets,
      scale: 4,
      position: { x: -200, y: Number.POSITIVE_INFINITY },
    })).toEqual({ ...DEFAULT_PREFS.pets, position: { x: -200, y: 0 } })
  })
})
