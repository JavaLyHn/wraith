import path from 'path'
import fs from 'fs'
import type { EditorApp } from '../shared/editors'

/** 已知编辑器:.app bundle 名 → 展示名。detectEditors 按此顺序输出已装的。 */
const KNOWN_EDITORS: { app: string; name: string }[] = [
  { app: 'Terminal.app', name: 'Terminal' },
  { app: 'Visual Studio Code.app', name: 'VS Code' },
  { app: 'Cursor.app', name: 'Cursor' },
  { app: 'Xcode.app', name: 'Xcode' },
  { app: 'IntelliJ IDEA.app', name: 'IntelliJ IDEA' },
  { app: 'IntelliJ IDEA CE.app', name: 'IntelliJ IDEA CE' },
  { app: 'Sublime Text.app', name: 'Sublime Text' },
  { app: 'Zed.app', name: 'Zed' },
]

/** 从绝对 .app 路径列表挑出已知已装编辑器,按 KNOWN_EDITORS 顺序、按 name 去重。纯函数。 */
export function detectEditors(appPaths: readonly string[]): EditorApp[] {
  const out: EditorApp[] = []
  for (const known of KNOWN_EDITORS) {
    const hit = appPaths.find(p => path.basename(p) === known.app)
    if (hit) out.push({ name: known.name, appPath: hit })
  }
  return out
}

/** 目标文件名去重:base 不冲突原样;否则 `stem (2).ext`、`(3)`… 递增。纯函数。 */
export function uniqueDownloadName(existing: ReadonlySet<string>, base: string): string {
  if (!existing.has(base)) return base
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`
    if (!existing.has(cand)) return cand
  }
}

/** target 是否等于或位于 workspace 之下(归一化后 path.relative 不以 .. 开头且非绝对)。workspace 空 → false。 */
export function isPathWithinWorkspace(target: string, workspace: string): boolean {
  if (!workspace) return false
  const rel = path.relative(path.resolve(workspace), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 文件级撤销:modified 写回 before;created 删除。路径必须在工作区内、before ≤ 5MB。破坏性写,绝不信任调用方路径。 */
export async function performUndo(
  req: { workspace: string | null; path: string; before: string; kind: 'created' | 'modified' },
): Promise<{ ok: boolean; message?: string }> {
  if (!req.workspace) return { ok: false, message: '无工作区' }
  if (!isPathWithinWorkspace(req.path, req.workspace)) return { ok: false, message: '路径超出工作区' }
  if (Buffer.byteLength(req.before, 'utf8') > 5 * 1024 * 1024) return { ok: false, message: '内容超过 5MB' }
  try {
    if (req.kind === 'created') await fs.promises.rm(req.path, { force: true })
    else await fs.promises.writeFile(req.path, req.before, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** 已知 Windows 编辑器:展示名 → 候选安装位置(base=环境变量名,rel=相对该目录的 exe)。
 *  覆盖默认安装路径;自定义目录/注册表安装不在 v1 覆盖内(将来可选增强)。 */
const KNOWN_WINDOWS_EDITORS: { name: string; candidates: { base: string; rel: string }[] }[] = [
  { name: 'VS Code', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code\\Code.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code\\Code.exe' },
  ] },
  { name: 'VS Code Insiders', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code Insiders\\Code - Insiders.exe' },
  ] },
  { name: 'Cursor', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\cursor\\Cursor.exe' },
  ] },
  { name: 'Sublime Text', candidates: [
    { base: 'ProgramFiles', rel: 'Sublime Text\\sublime_text.exe' },
  ] },
  { name: 'Notepad++', candidates: [
    { base: 'ProgramFiles', rel: 'Notepad++\\notepad++.exe' },
    { base: 'ProgramFiles(x86)', rel: 'Notepad++\\notepad++.exe' },
  ] },
]

/** 从已知安装路径探测已装的 Windows 编辑器。env、exists 均注入以便纯函数单测。
 *  每编辑器按候选顺序取首个存在者,最多一条(天然按 name 去重)。用 path.win32.join
 *  保证跨宿主(含 mac 测试)都产 Windows 风格路径。 */
export function detectWindowsEditors(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): EditorApp[] {
  const out: EditorApp[] = []
  for (const ed of KNOWN_WINDOWS_EDITORS) {
    for (const c of ed.candidates) {
      const baseDir = env[c.base]
      if (!baseDir) continue
      const full = path.win32.join(baseDir, c.rel)
      if (exists(full)) { out.push({ name: ed.name, appPath: full }); break }
    }
  }
  return out
}

export type OpenWithPlan =
  | { kind: 'spawn'; cmd: string; args: string[] }
  | { kind: 'shellOpen'; target: string }

/**
 * 决定"用某编辑器打开文件"在当前平台怎么执行。
 * darwin 用 `open -a <app> <file>`;win32 的 appPath 是编辑器 exe(见 detectWindowsEditors),
 * 直接 spawn 该 exe 开文件;其余平台(linux)没有等价语义,退回系统默认程序打开(shell.openPath)。
 */
export function resolveOpenWithPlan(
  platform: NodeJS.Platform,
  appPath: string,
  filePath: string,
): OpenWithPlan {
  if (platform === 'darwin') {
    return { kind: 'spawn', cmd: 'open', args: ['-a', appPath, filePath] }
  }
  if (platform === 'win32') {
    // Windows:appPath 是编辑器 exe(由 detectWindowsEditors 探得),直接 spawn 开文件(无 -a)
    return { kind: 'spawn', cmd: appPath, args: [filePath] }
  }
  return { kind: 'shellOpen', target: filePath }
}
