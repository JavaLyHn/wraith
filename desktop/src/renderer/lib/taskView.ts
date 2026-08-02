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
 * <p><b>重试 = 新建一条 + 删掉原来那条</b>，列表里只留最新的。
 * 最初落地时我保留了失败记录（理由是「失败发生过，审计上不该抹掉」），用户否了：
 * 这是任务队列面板不是审计日志（真审计在 `~/.wraith/audit/`），
 * 连试三次就有三条僵尸记录压在上面，把在跑的那条挤没了。
 */
export function taskCanRetry(status: string): boolean {
  return status === 'failed' || status === 'canceled'
}

/**
 * 是否给「删除」入口。
 *
 * <p>只给终态。运行中/排队中的任务 worker 线程还握着它，删了行它照样在改文件，
 * 而面板上它已经消失 —— 这种状态没法向用户解释。要删就先取消。
 * 后端 {@code DurableTaskManager.delete} 同样硬拒；两层不是重复，
 * 后端那层防的是别的调用方（终端 `/task`、IM 网关）。
 *
 * <p>白名单而非「非运行即可删」：认不出的状态一律不给，宁可少一个按钮。
 */
export function taskCanDelete(status: string): boolean {
  return taskIsTerminal(status)
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
