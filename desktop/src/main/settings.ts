/**
 * settings — tiny persisted app settings (Electron userData/settings.json).
 *
 * Kept out of the renderer and out of `src/shared/` (that stays pure protocol
 * TS). Takes the userData directory as a parameter so it is fully unit-testable
 * without Electron's `app.getPath('userData')`, mirroring backend.ts's style.
 */

import fs from 'fs'
import path from 'path'

export interface Settings {
  /** Last workspace directory the user explicitly picked. */
  workspace?: string
}

export function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json')
}

/** Read settings; returns {} on any error (missing file, bad JSON). */
export function readSettings(userDataDir: string): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(userDataDir), 'utf8')
    const obj = JSON.parse(raw) as unknown
    return obj && typeof obj === 'object' ? (obj as Settings) : {}
  } catch {
    return {}
  }
}

/** Write settings (best-effort; swallows write errors). */
export function writeSettings(userDataDir: string, s: Settings): void {
  try {
    fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(s, null, 2), 'utf8')
  } catch {
    // best-effort — a failed persist must never crash the app
  }
}

/**
 * Resolve the persisted workspace IF it still exists and is a directory.
 * Returns null when there is no valid persisted workspace (caller falls back,
 * e.g. to the home directory). Never throws.
 */
export function resolvePersistedWorkspace(userDataDir: string): string | null {
  const ws = readSettings(userDataDir).workspace
  try {
    if (ws && fs.existsSync(ws) && fs.statSync(ws).isDirectory()) return ws
  } catch {
    // fall through
  }
  return null
}

/** Persist the chosen workspace, preserving other settings keys. */
export function persistWorkspace(userDataDir: string, workspace: string): void {
  writeSettings(userDataDir, { ...readSettings(userDataDir), workspace })
}
