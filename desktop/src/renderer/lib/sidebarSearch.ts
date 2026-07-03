import type { ProjectView } from '../../shared/types'

export interface SessionFilterItem {
  id: string
  title: string
}

export interface FilterResult {
  sessions: SessionFilterItem[]
  projects: ProjectView[]
}

/**
 * 侧栏搜索纯过滤函数。
 * - 不区分大小写的 contains 匹配
 * - title 为空时按 '未命名' 参与匹配
 * - 项目按显示名(name)或路径尾段过滤
 * - 空 query 直接返回原列表
 */
export function filterSidebar(
  sessions: SessionFilterItem[],
  projects: ProjectView[],
  query: string,
): FilterResult {
  if (!query) {
    return { sessions, projects }
  }

  const q = query.toLowerCase()

  const filteredSessions = sessions.filter(s => {
    const title = (s.title || '未命名').toLowerCase()
    return title.includes(q)
  })

  const filteredProjects = projects.filter(p => {
    const displayName = p.name
      ? p.name.toLowerCase()
      : p.path.split('/').filter(Boolean).pop()?.toLowerCase() ?? ''
    const pathTail = p.path.split('/').filter(Boolean).pop()?.toLowerCase() ?? ''
    return displayName.includes(q) || pathTail.includes(q)
  })

  return { sessions: filteredSessions, projects: filteredProjects }
}
