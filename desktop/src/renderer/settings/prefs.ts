export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentKey = 'teal' | 'indigo' | 'emerald' | 'rose' | 'amber'
export type FontSize = 'sm' | 'md' | 'lg'
export type FontFamily = 'system' | 'sans' | 'mono'

export interface UiPrefs { theme: ThemeMode; accent: AccentKey; fontSize: FontSize; fontFamily: FontFamily }
export interface ProfilePrefs { name: string; avatar: string }
export interface UpdatePrefs { autoCheck: boolean; beta: boolean }
export interface Prefs { profile: ProfilePrefs; ui: UiPrefs; update: UpdatePrefs }

export const DEFAULT_PREFS: Prefs = {
  profile: { name: '我', avatar: '' },
  ui: { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' },
  update: { autoCheck: true, beta: false },
}

const KEY = 'wraith.prefs'
const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS: AccentKey[] = ['teal', 'indigo', 'emerald', 'rose', 'amber']
const SIZES: FontSize[] = ['sm', 'md', 'lg']
const FAMILIES: FontFamily[] = ['system', 'sans', 'mono']

function oneOf<T>(v: unknown, allowed: T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt
}

export function loadPrefs(read: (k: string) => string | null = (k) => localStorage.getItem(k)): Prefs {
  let raw: unknown = {}
  try { const s = read(KEY); if (s) raw = JSON.parse(s) } catch { raw = {} }
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const prof = (p.profile && typeof p.profile === 'object' ? p.profile : {}) as Record<string, unknown>
  const ui = (p.ui && typeof p.ui === 'object' ? p.ui : {}) as Record<string, unknown>
  const upd = (p.update && typeof p.update === 'object' ? p.update : {}) as Record<string, unknown>
  return {
    profile: {
      name: typeof prof.name === 'string' && prof.name.trim() ? (prof.name as string) : DEFAULT_PREFS.profile.name,
      avatar: typeof prof.avatar === 'string' ? (prof.avatar as string) : '',
    },
    ui: {
      theme: oneOf(ui.theme, THEMES, DEFAULT_PREFS.ui.theme),
      accent: oneOf(ui.accent, ACCENT_KEYS, DEFAULT_PREFS.ui.accent),
      fontSize: oneOf(ui.fontSize, SIZES, DEFAULT_PREFS.ui.fontSize),
      fontFamily: oneOf(ui.fontFamily, FAMILIES, DEFAULT_PREFS.ui.fontFamily),
    },
    update: {
      autoCheck: typeof upd.autoCheck === 'boolean' ? (upd.autoCheck as boolean) : DEFAULT_PREFS.update.autoCheck,
      beta: typeof upd.beta === 'boolean' ? (upd.beta as boolean) : DEFAULT_PREFS.update.beta,
    },
  }
}

export function savePrefs(prefs: Prefs, write: (k: string, v: string) => void = (k, v) => localStorage.setItem(k, v)): void {
  try { write(KEY, JSON.stringify(prefs)) } catch { /* 忽略配额/序列化失败 */ }
}
