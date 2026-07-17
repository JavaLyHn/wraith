import { describe, it, expect } from 'vitest'
import { resolveThemeVars, ACCENTS, hexToRgbTriplet } from '../src/renderer/settings/theme'
import type { UiPrefs } from '../src/renderer/settings/prefs'

const base: UiPrefs = { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' }

describe('resolveThemeVars', () => {
  it('system 跟随 systemDark', () => {
    expect(resolveThemeVars(base, true).dataTheme).toBe('dark')
    expect(resolveThemeVars(base, false).dataTheme).toBe('light')
  })
  it('显式 light/dark 忽略 systemDark', () => {
    expect(resolveThemeVars({ ...base, theme: 'light' }, true).dataTheme).toBe('light')
    expect(resolveThemeVars({ ...base, theme: 'dark' }, false).dataTheme).toBe('dark')
  })
  it('强调色映射为 hex', () => {
    expect(resolveThemeVars({ ...base, accent: 'rose' }, false).vars['--accent']).toBe(ACCENTS.rose.value)
  })
  it('字号映射为 scale', () => {
    expect(resolveThemeVars({ ...base, fontSize: 'sm' }, false).vars['--font-scale']).toBe('0.925')
    expect(resolveThemeVars({ ...base, fontSize: 'lg' }, false).vars['--font-scale']).toBe('1.075')
  })
  it('字体映射为字体栈(mono 含 JetBrains Mono)', () => {
    expect(resolveThemeVars({ ...base, fontFamily: 'mono' }, false).vars['--font-sans']).toContain('JetBrains Mono')
  })
})

describe('hexToRgbTriplet', () => {
  it('#0ea5b7 → 14 165 183', () => {
    expect(hexToRgbTriplet('#0ea5b7')).toBe('14 165 183')
  })
  it('#fff → 255 255 255(3位简写)', () => {
    expect(hexToRgbTriplet('#fff')).toBe('255 255 255')
  })
})

describe('resolveThemeVars --accent-rgb', () => {
  it('rose accent 下发正确 --accent-rgb', () => {
    const result = resolveThemeVars({ ...base, accent: 'rose' }, false)
    expect(result.vars['--accent-rgb']).toBe(hexToRgbTriplet(ACCENTS.rose.value))
  })
})
