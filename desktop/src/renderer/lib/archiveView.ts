import { baseName } from './paths'
import { sessionDisplayName } from './sessionView'
import type { SessionMeta, ProjectView } from '../../shared/types'

/** 归档列表一行的渲染数据。 */
export interface ArchiveRowData {
  meta: SessionMeta
  /** name ?? title */
  displayName: string
  /** 项目别名 ?? 目录名。cwd 不在已知项目里时也回落目录名,不留空 */
  projectLabel: string
}

/** 后端已按 archivedAt 倒序,这里只做标签解析,不重排。 */
export function buildArchiveRows(sessions: SessionMeta[], projects: ProjectView[]): ArchiveRowData[] {
  const nameByPath = new Map(projects.map(p => [p.path, p.name]))
  return sessions.map(meta => ({
    meta,
    displayName: sessionDisplayName(meta),
    // 归档可能来自一个已从列表移出的项目 —— 那也得显示得出来,所以回落目录名
    projectLabel: nameByPath.get(meta.cwd) || baseName(meta.cwd),
  }))
}

/** 标题子串 + 项目路径,两者是与关系。projectPath 为 null/空 = 不按项目筛。 */
export function filterArchive(
  rows: ArchiveRowData[],
  query: string,
  projectPath: string | null,
): ArchiveRowData[] {
  const q = query.trim().toLowerCase()
  return rows.filter(r => {
    if (projectPath && r.meta.cwd !== projectPath) return false
    if (!q) return true
    return r.displayName.toLowerCase().includes(q)
  })
}

/**
 * 项目筛选下拉的选项。只列**归档条目实际涉及**的项目 ——
 * 列出全部已知项目会让下拉里出现一堆选了必然为空的项。
 */
export function archiveProjectOptions(rows: ArchiveRowData[]): { value: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    if (!seen.has(r.meta.cwd)) seen.set(r.meta.cwd, r.projectLabel)
  }
  return [
    { value: '', label: '全部' },
    ...[...seen.entries()].map(([value, label]) => ({ value, label })),
  ]
}
