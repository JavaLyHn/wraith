import { describe, it, expect } from 'vitest'
import { loadPrefs, savePrefs, DEFAULT_PREFS } from '../src/renderer/settings/prefs'

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
