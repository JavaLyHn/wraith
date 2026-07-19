import type { PetMotionStyle } from '../../shared/pets'

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentKey = 'teal' | 'indigo' | 'emerald' | 'rose' | 'amber'
export type FontSize = 'sm' | 'md' | 'lg'
export type FontFamily = 'system' | 'sans' | 'mono'

export interface UiPrefs { theme: ThemeMode; accent: AccentKey; fontSize: FontSize; fontFamily: FontFamily }
export interface ProfilePrefs { name: string; avatar: string }
export interface UpdatePrefs { autoCheck: boolean; beta: boolean }
export interface PetPrefs {
  enabled: boolean
  selectedId: string | null
  motion: PetMotionStyle
  scale: number
  position: { x: number; y: number }
}
export interface Prefs { profile: ProfilePrefs; ui: UiPrefs; update: UpdatePrefs; pets: PetPrefs }

export const DEFAULT_PREFS: Prefs = {
  profile: { name: '我', avatar: '' },
  ui: { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' },
  update: { autoCheck: true, beta: false },
  pets: { enabled: true, selectedId: null, motion: 'calm', scale: 1, position: { x: 0, y: 0 } },
}

const KEY = 'wraith.prefs'
const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS: AccentKey[] = ['teal', 'indigo', 'emerald', 'rose', 'amber']
const SIZES: FontSize[] = ['sm', 'md', 'lg']
const FAMILIES: FontFamily[] = ['system', 'sans', 'mono']
const MOTION_STYLES: PetMotionStyle[] = ['calm', 'float', 'lively', 'static']

function oneOf<T>(v: unknown, allowed: T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt
}

// 拖拽偏移的持久化上限:仅作垃圾值过滤(拒 NaN/Infinity/离谱大数),而非视觉边界。
// 真正的视觉边界由 PetAvatar 按定位容器实测动态夹(见 dragBounds/clampPoint),
// 因此这里放宽到与 MAX_DIMENSION 同量级的 ±4096——任何真实窗口内的拖动落点都能持久化,
// 不会像旧的 ±160 那样把稍大的合法偏移一律重置成 0(那正是"最高只能拖到某处"的根因之一)。
const MAX_POSITION_OFFSET = 4096

function normalizedPosition(value: unknown): PetPrefs['position'] {
  const position = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const normalize = (coordinate: unknown, fallback: number): number =>
    typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= -MAX_POSITION_OFFSET && coordinate <= MAX_POSITION_OFFSET
      ? coordinate
      : fallback
  return {
    x: normalize(position.x, DEFAULT_PREFS.pets.position.x),
    y: normalize(position.y, DEFAULT_PREFS.pets.position.y),
  }
}

export function normalizePetPrefs(value: unknown): PetPrefs {
  const pets = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    enabled: typeof pets.enabled === 'boolean' ? pets.enabled : DEFAULT_PREFS.pets.enabled,
    selectedId: typeof pets.selectedId === 'string' ? pets.selectedId : DEFAULT_PREFS.pets.selectedId,
    motion: oneOf(pets.motion, MOTION_STYLES, DEFAULT_PREFS.pets.motion),
    scale: typeof pets.scale === 'number' && Number.isFinite(pets.scale) && pets.scale >= 0.75 && pets.scale <= 1.5
      ? pets.scale
      : DEFAULT_PREFS.pets.scale,
    position: normalizedPosition(pets.position),
  }
}

export function loadPrefs(read: (k: string) => string | null = (k) => localStorage.getItem(k)): Prefs {
  let raw: unknown = {}
  try { const s = read(KEY); if (s) raw = JSON.parse(s) } catch { raw = {} }
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const prof = (p.profile && typeof p.profile === 'object' ? p.profile : {}) as Record<string, unknown>
  const ui = (p.ui && typeof p.ui === 'object' ? p.ui : {}) as Record<string, unknown>
  const upd = (p.update && typeof p.update === 'object' ? p.update : {}) as Record<string, unknown>
  const pets = (p.pets && typeof p.pets === 'object' ? p.pets : {}) as Record<string, unknown>
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
    pets: normalizePetPrefs(pets),
  }
}

export function savePrefs(prefs: Prefs, write: (k: string, v: string) => void = (k, v) => localStorage.setItem(k, v)): void {
  try { write(KEY, JSON.stringify(prefs)) } catch { /* 忽略配额/序列化失败 */ }
}
