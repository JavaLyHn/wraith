import { baseName } from './paths'
import type { ProjectView, ProjectSummary } from '../../shared/types'

export type ProjectSortKey = 'name' | 'updated'
export type SortDir = 'asc' | 'desc'

/** 一行的渲染数据:项目条目 + 该项目的会话概况。 */
export interface ProjectRowData {
  view: ProjectView
  /** name ?? 目录名 */
  displayName: string
  /** 未归档会话数;null = 概况还没回来(渲染骨架) */
  sessionCount: number | null
  /** 最新未归档会话时间;null = 无会话 或 概况还没回来 */
  lastSessionAt: string | null
}

/**
 * 把 listProjects 的条目与 projectSummary 的概况按 path 对齐。
 * 顺序跟随 projects(它已按 lastUsedAt 倒序),概况缺失 → sessionCount=null。
 */
export function mergeSummaries(projects: ProjectView[], summaries: ProjectSummary[]): ProjectRowData[] {
  const byPath = new Map(summaries.map(s => [s.path, s]))
  return projects.map(view => {
    const s = byPath.get(view.path)
    return {
      view,
      displayName: view.name || baseName(view.path),
      sessionCount: s ? s.sessionCount : null,
      lastSessionAt: s ? s.lastSessionAt : null,
    }
  })
}

/** 名称 + 路径双字段子串,不区分大小写。空查询回全量(同一个数组引用不保证)。 */
export function filterProjects(rows: ProjectRowData[], query: string): ProjectRowData[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows.slice()
  return rows.filter(r =>
    r.displayName.toLowerCase().includes(q) || r.view.path.toLowerCase().includes(q))
}

/**
 * 双列排序。不改原数组。
 * 「无会话」(lastSessionAt=null)恒排末尾且不受 dir 影响 —— 让它跟着方向来回跳
 * 会让「按时间排」这件事看起来是坏的。
 */
export function sortProjects(rows: ProjectRowData[], key: ProjectSortKey, dir: SortDir): ProjectRowData[] {
  const sign = dir === 'asc' ? 1 : -1
  const out = rows.slice()
  out.sort((a, b) => {
    if (key === 'name') {
      return sign * a.displayName.localeCompare(b.displayName, 'zh-Hans-CN', { sensitivity: 'base' })
    }
    const av = a.lastSessionAt
    const bv = b.lastSessionAt
    if (av === null && bv === null) return 0
    if (av === null) return 1     // 无会话恒后
    if (bv === null) return -1
    return sign * av.localeCompare(bv)   // ISO-8601 字典序 == 时间序
  })
  return out
}

/** 重点 / 其余 两段。各自保持传入顺序(调用方先排好再分区)。 */
export function partitionStarredProjects(rows: ProjectRowData[]): {
  starred: ProjectRowData[]
  rest: ProjectRowData[]
} {
  const starred: ProjectRowData[] = []
  const rest: ProjectRowData[] = []
  for (const r of rows) {
    if (r.view.starred) starred.push(r)
    else rest.push(r)
  }
  return { starred, rest }
}

/**
 * 短相对时间:'—' / '刚刚' / 'N 分' / 'N 小时' / 'N 天' / 'N 个月'。
 *
 * 不复用 contextPanelView.relativeTime:那个封顶在「N 小时前」且带「前」字,
 * 这里要无后缀短式 + 天/月档。老的在上下文面板里语义正确,不动它。
 */
export function shortRelativeTime(iso: string | null, now: number): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))   // 未来时间夹到 0 → '刚刚'
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`
  const days = Math.floor(s / 86400)
  if (days < 30) return `${days} 天`
  return `${Math.floor(days / 30)} 个月`
}
