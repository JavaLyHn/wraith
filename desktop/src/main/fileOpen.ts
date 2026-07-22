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
