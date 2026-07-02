/**
 * settings — tiny persisted app settings (Electron userData/settings.json).
 *
 * Kept out of the renderer and out of `src/shared/` (that stays pure protocol
 * TS). Takes the userData directory as a parameter so it is fully unit-testable
 * without Electron's `app.getPath('userData')`, mirroring backend.ts's style.
 */

import fs from 'fs'
import path from 'path'
import type { ProjectView } from '../shared/types'

export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用目录名
  lastUsedAt: number  // epoch ms,最近使用排序
}

export interface Settings {
  /** Last workspace directory the user explicitly picked. */
  workspace?: string
  /** 打开过的项目列表(Phase D)。 */
  projects?: ProjectEntry[]
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

/** 按 path 去重插入/刷新 lastUsedAt;保留既有别名;其余 settings 键不动。 */
export function upsertProject(userDataDir: string, projectPath: string, now: number): void {
  const s = readSettings(userDataDir)
  const rest = (s.projects ?? []).filter(p => p.path !== projectPath)
  const existing = (s.projects ?? []).find(p => p.path === projectPath)
  writeSettings(userDataDir, {
    ...s,
    projects: [...rest, { ...existing, path: projectPath, lastUsedAt: now }],
  })
}

/** 仅移出列表;磁盘目录与 ~/.wraith 会话历史不动。 */
export function removeProject(userDataDir: string, projectPath: string): void {
  const s = readSettings(userDataDir)
  writeSettings(userDataDir, { ...s, projects: (s.projects ?? []).filter(p => p.path !== projectPath) })
}

/** 设别名(trim);空串清除别名(回退目录名)。 */
export function renameProject(userDataDir: string, projectPath: string, name: string): void {
  const s = readSettings(userDataDir)
  const trimmed = name.trim()
  const projects = (s.projects ?? []).map(p => {
    if (p.path !== projectPath) return p
    if (!trimmed) {
      const { name: _drop, ...restEntry } = p
      return restEntry
    }
    return { ...p, name: trimmed }
  })
  writeSettings(userDataDir, { ...s, projects })
}

/** lastUsedAt 倒序 + exists(失踪条目保留置灰,不静默过滤)。 */
export function projectViews(userDataDir: string): ProjectView[] {
  return (readSettings(userDataDir).projects ?? [])
    .slice()
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map(p => {
      let exists = false
      try {
        exists = fs.statSync(p.path).isDirectory()
      } catch {
        // 不存在/不可达 → false
      }
      return { ...p, exists }
    })
}

/** 迁移播种:projects 为空且现有 workspace 有效 → 用它播一条(老用户无感升级)。 */
export function seedProjectsIfEmpty(userDataDir: string, now: number): void {
  if ((readSettings(userDataDir).projects ?? []).length > 0) return
  const ws = resolvePersistedWorkspace(userDataDir)
  if (ws) upsertProject(userDataDir, ws, now)
}

/** E2E 播种式注入:整体覆盖 projects;坏 JSON/非数组 no-op。 */
export function seedProjectsFromJson(userDataDir: string, json: string, now: number): void {
  let arr: unknown
  try {
    arr = JSON.parse(json)
  } catch {
    return
  }
  if (!Array.isArray(arr)) return
  const projects: ProjectEntry[] = arr
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { path?: unknown }).path === 'string')
    .map((p, i) => ({
      path: p['path'] as string,
      ...(typeof p['name'] === 'string' && p['name'] ? { name: p['name'] as string } : {}),
      lastUsedAt: typeof p['lastUsedAt'] === 'number' ? (p['lastUsedAt'] as number) : now - i,
    }))
  const s = readSettings(userDataDir)
  writeSettings(userDataDir, { ...s, projects })
}
