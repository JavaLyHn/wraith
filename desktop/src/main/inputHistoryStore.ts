/**
 * inputHistoryStore — per-session input history persistence (userData/input-history.json).
 *
 * Stores the last N submitted inputs per session, allowing the user to
 * navigate back through previously sent messages with ↑/↓ in the Composer.
 *
 * Kept out of renderer and shared/ — pure Node fs, testable with any userData dir.
 */

import fs from 'fs'
import path from 'path'

export const MAX_HISTORY_PER_SESSION = 100

type InputHistoryStore = Record<string, string[]>

export function inputHistoryPath(userDataDir: string): string {
  return path.join(userDataDir, 'input-history.json')
}

export function readInputHistory(userDataDir: string): InputHistoryStore {
  try {
    const raw = fs.readFileSync(inputHistoryPath(userDataDir), 'utf8')
    const obj = JSON.parse(raw) as unknown
    if (obj && typeof obj === 'object') return obj as InputHistoryStore
    return {}
  } catch {
    return {}
  }
}

export function writeInputHistory(userDataDir: string, store: InputHistoryStore): void {
  try {
    fs.writeFileSync(inputHistoryPath(userDataDir), JSON.stringify(store, null, 2), 'utf8')
  } catch {
    // best-effort — a failed persist must never crash the app
  }
}

/** Get input history for a session (oldest → newest). */
export function getSessionHistory(userDataDir: string, sessionId: string): string[] {
  const store = readInputHistory(userDataDir)
  return store[sessionId] ?? []
}

/**
 * Append a submitted input to the session's history.
 * - Empty/whitespace-only inputs are not recorded.
 * - Duplicate of the most recent entry is skipped (prevents "ENTER 连发" 膨胀).
 * - When count exceeds MAX, the oldest entries are trimmed (FIFO).
 */
export function addToSessionHistory(userDataDir: string, sessionId: string, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return

  const store = readInputHistory(userDataDir)
  const existing = store[sessionId] ?? []

  if (existing.length > 0 && existing[existing.length - 1] === trimmed) {
    return
  }

  existing.push(trimmed)

  if (existing.length > MAX_HISTORY_PER_SESSION) {
    store[sessionId] = existing.slice(-MAX_HISTORY_PER_SESSION)
  } else {
    store[sessionId] = existing
  }

  writeInputHistory(userDataDir, store)
}

/** Clear input history for a session. */
export function clearSessionHistory(userDataDir: string, sessionId: string): void {
  const store = readInputHistory(userDataDir)
  if (store[sessionId]) {
    delete store[sessionId]
    writeInputHistory(userDataDir, store)
  }
}
