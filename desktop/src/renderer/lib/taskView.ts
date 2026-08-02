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

/**
 * 是否给「重试」入口。
 *
 * <p>只给 failed / canceled —— 这两种是**没拿到结果**的，用户多半想再跑一次。
 * `completed` 不给：重跑一个已经成功的任务是另一回事（「再跑一遍」而不是「重试」），
 * 而且后台任务会改文件、执行命令，误点的代价不小。真想再跑，输入框还在。
 *
 * <p>重试的语义是**新建一条**，不是原地复活：原来那条失败记录留着。
 * 审计上说得通（失败发生过），也让人看得见「第一次为什么失败」。
 */
export function taskCanRetry(status: string): boolean {
  return status === 'failed' || status === 'canceled'
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
