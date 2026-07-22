import path from 'path'
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
