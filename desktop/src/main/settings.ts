/**
 * settings — tiny persisted app settings (Electron userData/settings.json).
 *
 * Kept out of the renderer and out of `src/shared/` (that stays pure protocol
 * TS). Takes the userData directory as a parameter so it is fully unit-testable
 * without Electron's `app.getPath('userData')`, mirroring backend.ts's style.
 */

import fs from 'fs'
import path from 'path'
import type { ProjectView, CloseMode } from '../shared/types'
import type { PetMotionStyle } from '../shared/pets'

export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用目录名
  lastUsedAt: number  // epoch ms,最近使用排序
  starred?: boolean   // 用户标记的重点项目;面板与快切下拉都置顶。false 不落盘,只删键
  order?: number      // 同一收藏分组内的手动顺序;旧 settings 缺失时按历史顺序补齐
}

export interface Settings {
  /** Last workspace directory the user explicitly picked. */
  workspace?: string
  /** 打开过的项目列表(Phase D)。 */
  projects?: ProjectEntry[]
  /** 桌面宠物配置(全局常驻窗口)。 */
  pets?: PetConfig
  /** 关闭主窗时的行为:'ask'=每次问,'background'=挂后台,'quit'=直接退出。 */
  closeMode?: CloseMode
}

/** 缩放范围。PET_SCALE_MIN 同时是"缩放关闭时"的固定尺寸(见 normalizePetConfig)。 */
export const PET_SCALE_MIN = 0.5
export const PET_SCALE_MAX = 2.0

export interface PetConfig {
  enabled: boolean
  selectedId: string | null
  motion: PetMotionStyle
  scale: number
  position: { x: number; y: number } | null  // 屏幕全局坐标;null=未放置,首次显示落默认位
  locked: boolean  // 锁定:禁用拖动/缩放,防误触(右键菜单仍可用以解锁)
  scaleEnabled: boolean  // 缩放开关:默认关闭;关闭时 scale 恒为最小(PET_SCALE_MIN),用户显式开启后才能缩放
}

// 默认:缩放关闭 + 尺寸最小(scaleEnabled=false 会让 normalize 把 scale 强制成 PET_SCALE_MIN)。
export const DEFAULT_PET_CONFIG: PetConfig = { enabled: true, selectedId: null, motion: 'calm', scale: PET_SCALE_MIN, position: null, locked: false, scaleEnabled: false }
const MOTION: PetMotionStyle[] = ['calm', 'float', 'lively', 'static']

/** 未知/缺失/非法字段一律回落默认;scale 夹到 [0.5,2.0]且缩放关闭时强制最小;position 须为有限坐标或 null。 */
export function normalizePetConfig(value: unknown): PetConfig {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const pos = v['position']
  const posOk = !!pos && typeof pos === 'object'
    && Number.isFinite((pos as any).x) && Number.isFinite((pos as any).y)
  const scaleEnabled = typeof v['scaleEnabled'] === 'boolean' ? v['scaleEnabled'] as boolean : DEFAULT_PET_CONFIG.scaleEnabled
  const rawScale = typeof v['scale'] === 'number' && Number.isFinite(v['scale']) && (v['scale'] as number) >= PET_SCALE_MIN && (v['scale'] as number) <= PET_SCALE_MAX
    ? v['scale'] as number : DEFAULT_PET_CONFIG.scale
  return {
    enabled: typeof v['enabled'] === 'boolean' ? v['enabled'] as boolean : DEFAULT_PET_CONFIG.enabled,
    selectedId: typeof v['selectedId'] === 'string' ? v['selectedId'] as string : null,
    motion: MOTION.includes(v['motion'] as PetMotionStyle) ? v['motion'] as PetMotionStyle : DEFAULT_PET_CONFIG.motion,
    // 缩放关闭时恒为最小尺寸(用户须显式开启缩放才生效);开启时用校验后的 scale。这是"关闭⇒最小"的唯一强制点,
    // 无论 scale 从哪条路径写入(设置滑块/滚轮/捏合/右键菜单),只要 scaleEnabled=false 就一律落回 PET_SCALE_MIN。
    scale: scaleEnabled ? rawScale : PET_SCALE_MIN,
    position: posOk ? { x: (pos as any).x as number, y: (pos as any).y as number } : null,
    locked: typeof v['locked'] === 'boolean' ? v['locked'] as boolean : DEFAULT_PET_CONFIG.locked,
    scaleEnabled,
  }
}

/** 读取 settings.json 的 pets 键并 normalize;缺失/坏数据回落默认。 */
export function readPetConfig(userDataDir: string): PetConfig {
  return normalizePetConfig((readSettings(userDataDir) as { pets?: unknown }).pets)
}

/** patch 与既有配置合并 + normalize + 持久化,返回合并后的结果。 */
export function writePetConfig(userDataDir: string, patch: Partial<PetConfig>): PetConfig {
  const next = normalizePetConfig({ ...readPetConfig(userDataDir), ...patch })
  writeSettings(userDataDir, { ...readSettings(userDataDir), pets: next } as Settings)
  return next
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

/** 标记/取消重点项目。starred=false 时删掉这个键(与 renameProject 对空名的处理一致)。 */
export function setProjectStarred(userDataDir: string, projectPath: string, starred: boolean): void {
  const s = readSettings(userDataDir)
  const source = orderedProjectEntries(s.projects ?? [])
  const target = source.find(p => p.path === projectPath)
  if (!target) return
  const changed: ProjectEntry[] = source.map(p => {
    if (p.path !== projectPath) return p
    if (!starred) {
      const { starred: _drop, ...restEntry } = p
      return restEntry
    }
    return { ...p, starred: true }
  })
  const moved = changed.find(p => p.path === projectPath)!
  const destination = changed.filter(p => (p.starred === true) === starred).filter(p => p.path !== projectPath)
  destination.push(moved)
  const destinationOrder = new Map(destination.map((p, i) => [p.path, i]))
  const projects = changed.map(p => destinationOrder.has(p.path) ? { ...p, order: destinationOrder.get(p.path)! } : p)
  writeSettings(userDataDir, { ...s, projects })
}

function orderedProjectEntries(projects: ProjectEntry[]): ProjectEntry[] {
  return projects.slice().sort((a, b) => {
    const ao = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : null
    const bo = typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : null
    if (ao !== null && bo !== null && ao !== bo) return ao - bo
    if (ao !== null && bo === null) return -1
    if (ao === null && bo !== null) return 1
    return b.lastUsedAt - a.lastUsedAt
  })
}

/** 移动项目在其 starred 分组内的目标位置;非法路径/索引保持 settings 不变。 */
export function reorderProject(userDataDir: string, projectPath: string, targetIndex: number): void {
  const s = readSettings(userDataDir)
  const ordered = orderedProjectEntries(s.projects ?? [])
  const current = ordered.find(p => p.path === projectPath)
  if (!current || !Number.isInteger(targetIndex) || targetIndex < 0) return
  const bucket = ordered.filter(p => (p.starred === true) === (current.starred === true))
  if (targetIndex >= bucket.length) return
  const sourceIndex = bucket.findIndex(p => p.path === projectPath)
  if (sourceIndex < 0) return
  const [moved] = bucket.splice(sourceIndex, 1)
  bucket.splice(targetIndex, 0, moved!)
  const orderByPath = new Map<string, number>()
  for (const [i, p] of bucket.entries()) orderByPath.set(p.path, i)
  const projects = (s.projects ?? []).map(p => orderByPath.has(p.path) ? { ...p, order: orderByPath.get(p.path)! } : p)
  writeSettings(userDataDir, { ...s, projects })
}

/** lastUsedAt 倒序 + exists(失踪条目保留置灰,不静默过滤)。 */
export function projectViews(userDataDir: string): ProjectView[] {
  return orderedProjectEntries(readSettings(userDataDir).projects ?? [])
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
      ...(p['starred'] === true ? { starred: true as const } : {}),
      lastUsedAt: typeof p['lastUsedAt'] === 'number' ? (p['lastUsedAt'] as number) : now - i,
    }))
  const s = readSettings(userDataDir)
  writeSettings(userDataDir, { ...s, projects })
}

// ---------------------------------------------------------------------------
// 关闭行为 (closeMode)
// ---------------------------------------------------------------------------

const CLOSE_MODES: CloseMode[] = ['ask', 'background', 'quit']

/** 读取 closeMode;缺失/非法一律回落 'ask'。 */
export function readCloseMode(userDataDir: string): CloseMode {
  const raw = readSettings(userDataDir).closeMode
  return CLOSE_MODES.includes(raw as CloseMode) ? (raw as CloseMode) : 'ask'
}

/** 写入 closeMode;非法值忽略,落回 'ask'。 */
export function writeCloseMode(userDataDir: string, mode: CloseMode): void {
  const safe = CLOSE_MODES.includes(mode) ? mode : 'ask'
  writeSettings(userDataDir, { ...readSettings(userDataDir), closeMode: safe })
}
