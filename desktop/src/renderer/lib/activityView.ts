import type { ActivityItem, ActivityStatus } from '../../shared/types'

const RECENT_LIMIT = 10

const statusLabels: Record<ActivityStatus, string> = {
  running: '运行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  interrupted: '已中断',
  unknown: '未知',
}

const newestFirst = (items: ActivityItem[]): ActivityItem[] =>
  [...items].sort((left, right) => right.updatedAt - left.updatedAt)

/** Separates active work from the latest completed local activity records. */
export function activityGroups(items: ActivityItem[]): {
  running: ActivityItem[]
  waiting: ActivityItem[]
  recent: ActivityItem[]
} {
  return {
    running: newestFirst(items.filter(item => item.status === 'running')),
    waiting: newestFirst(items.filter(item => item.status === 'waiting')),
    recent: newestFirst(items.filter(item => item.status !== 'running' && item.status !== 'waiting')).slice(0, RECENT_LIMIT),
  }
}

/** Only work needing attention contributes to the activity-center badge. */
export function activityBadgeCount(items: ActivityItem[]): number {
  return items.filter(item => item.status === 'running' || item.status === 'waiting').length
}

export function activityStatusLabel(status: ActivityStatus): string {
  return statusLabels[status]
}

/** Prefers an explicit title, then the local project folder, then a useful error. */
export function activityTargetLabel(item: ActivityItem): string {
  if (item.title?.trim()) return item.title.trim()

  const project = item.projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  if (project) return project

  if (item.error?.trim()) return item.error.trim()
  return '未命名活动'
}
