import type { AutomationTask, ApprovalMode, DeliveryTarget } from '../../shared/types'
import { computeNextRun } from '../../main/automationSchedule'

/** 「下次 MM-DD HH:mm」标签;renderer 直接复用 main 的纯函数(无 Node 依赖)。 */
export function computeNextRunLabel(t: AutomationTask): string {
  if (t.lastFiredAt === null && t.enabledAt === 0) return '待触发'
  const next = new Date(computeNextRun(t.schedule, Date.now(), t.lastFiredAt, t.enabledAt))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `下次 ${pad(next.getMonth() + 1)}-${pad(next.getDate())} ${pad(next.getHours())}:${pad(next.getMinutes())}`
}

// ---------------------------------------------------------------------------
// cron 表达式前端轻校验(5 段 UNIX cron 基本形态;守护进程做权威校验)
// ---------------------------------------------------------------------------

/**
 * 判断字符串是否满足「5 个空白分隔、非空 token」的最简 cron 形态。
 * 仅前端轻校验,daemon 的 automations.upsert 做权威校验。
 */
export function isValidCronShape(expr: string): boolean {
  const tokens = expr.trim().split(/\s+/)
  return tokens.length === 5 && tokens.every(t => t.length > 0)
}

// ---------------------------------------------------------------------------
// ApprovalMode label 纯函数
// ---------------------------------------------------------------------------

/** 审批模式中文标签。 */
export function approvalModeLabel(mode: ApprovalMode): string {
  switch (mode) {
    case 'deny': return '拒绝(安全默认)'
    case 'auto-approve': return '自动批准'
    case 'ask': return '每次询问'
  }
}

// ---------------------------------------------------------------------------
// DeliveryTarget label 纯函数
// ---------------------------------------------------------------------------

/** 投递目标数组 → 简短中文描述列表(用于展示)。 */
export function deliveryTargetsToLabels(targets: DeliveryTarget[]): string[] {
  return targets.map(t => {
    if (t.platform === 'desktop') return '桌面通知'
    if (t.platform === 'qq') return 'QQ 消息'
    return t.platform
  })
}
