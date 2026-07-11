/** 后台任务状态/时长/摘要的展示辅助(纯函数,可测)。 */

export type TaskTone = 'pending' | 'running' | 'ok' | 'danger' | 'muted'

/** 后端状态串(enqueued/running/completed/failed/canceled)→ 中文。 */
export function taskStatusLabel(status: string): string {
  switch (status) {
    case 'enqueued': return '排队中'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'canceled': return '已取消'
    default: return status || '未知'
  }
}

/** 状态 → 徽标色调。 */
export function taskStatusTone(status: string): TaskTone {
  switch (status) {
    case 'enqueued': return 'pending'
    case 'running': return 'running'
    case 'completed': return 'ok'
    case 'failed': return 'danger'
    case 'canceled': return 'muted'
    default: return 'muted'
  }
}

/** 是否终态(不可取消)。 */
export function taskIsTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}

/** 时长毫秒 → 紧凑可读:850ms / 42s / 3m / 3m20s;0/无效 → 空串。 */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs ? `${m}m${rs}s` : `${m}m`
}

/** prompt 压平单行 + 截断,给列表用。 */
export function taskPromptSummary(prompt: string, max = 80): string {
  const one = (prompt || '').replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max) + '…'
}
