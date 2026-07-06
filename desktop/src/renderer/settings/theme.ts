import type { UiPrefs, AccentKey } from './prefs'

export const ACCENTS: Record<AccentKey, { label: string; value: string }> = {
  teal: { label: '青', value: '#0ea5b7' },
  indigo: { label: '靛', value: '#6366f1' },
  emerald: { label: '绿', value: '#10b981' },
  rose: { label: '玫红', value: '#f43f5e' },
  amber: { label: '琥珀', value: '#f59e0b' },
}

const FONT_SCALE: Record<UiPrefs['fontSize'], string> = { sm: '0.925', md: '1', lg: '1.075' }
const FONT_SANS: Record<UiPrefs['fontFamily'], string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sans: 'Inter, "Helvetica Neue", Arial, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
}

export interface ResolvedTheme { dataTheme: 'light' | 'dark'; vars: Record<string, string> }

export function resolveThemeVars(ui: UiPrefs, systemDark: boolean): ResolvedTheme {
  const dataTheme = ui.theme === 'system' ? (systemDark ? 'dark' : 'light') : ui.theme
  return {
    dataTheme,
    vars: {
      '--accent': ACCENTS[ui.accent].value,
      '--font-scale': FONT_SCALE[ui.fontSize],
      '--font-sans': FONT_SANS[ui.fontFamily],
    },
  }
}

export function applyTheme(ui: UiPrefs, systemDark: boolean): void {
  const { dataTheme, vars } = resolveThemeVars(ui, systemDark)
  const root = document.documentElement
  root.dataset.theme = dataTheme
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}
