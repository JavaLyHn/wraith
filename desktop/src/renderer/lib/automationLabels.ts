import type { AutomationTask, AutomationRun, ApprovalMode, ApprovalPolicy, DeliveryTarget } from '../../shared/types'
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

/** 审批模式中文标签。未知/未来模式返回 mode 字符串本身。 */
export function approvalModeLabel(mode: ApprovalMode): string {
  switch (mode) {
    case 'deny': return '拒绝(安全默认)'
    case 'auto-approve': return '自动批准'
    case 'ask': return '每次询问'
    default: return mode
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

// ---------------------------------------------------------------------------
// AutomationForm parse/build helpers(从 AutomationForm.tsx 提取,纯函数)
// ---------------------------------------------------------------------------

/** 解析 initial.deliverTo → desktop/qq 布尔值;新建任务默认 desktop=true */
export function parseDeliverTo(initial: AutomationTask | null): { desktop: boolean; qq: boolean } {
  if (!initial || !initial.deliverTo || initial.deliverTo.length === 0) {
    return { desktop: true, qq: false }
  }
  return {
    desktop: initial.deliverTo.some(d => d.platform === 'desktop'),
    qq: initial.deliverTo.some(d => d.platform === 'qq'),
  }
}

/** 构建 DeliveryTarget[] */
export function buildDeliverTo(desktop: boolean, qq: boolean): DeliveryTarget[] {
  const targets: DeliveryTarget[] = []
  if (desktop) targets.push({ platform: 'desktop' })
  if (qq) targets.push({ platform: 'qq' })
  return targets
}

// ---------------------------------------------------------------------------
// Approval filter helper (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Returns runs that are waiting for approval and have a valid approvalId.
 * Runs without approvalId are excluded — no button can be rendered for them.
 */
export function pendingApprovalRuns(runs: AutomationRun[]): AutomationRun[] {
  return runs.filter(r => r.status === 'waiting_approval' && Boolean(r.approvalId))
}

/** 解析 initial.approval;新建任务默认 {default:'deny'} */
export function parseApproval(initial: AutomationTask | null): {
  defaultMode: ApprovalMode
  toolOverrides: Array<{ tool: string; mode: ApprovalMode }>
  askTimeoutMinutes: string
} {
  const ap: ApprovalPolicy | undefined = initial?.approval
  if (!ap) return { defaultMode: 'deny', toolOverrides: [], askTimeoutMinutes: '' }
  return {
    defaultMode: ap.default,
    toolOverrides: ap.tools
      ? Object.entries(ap.tools).map(([tool, mode]) => ({ tool, mode }))
      : [],
    askTimeoutMinutes: ap.askTimeoutMinutes !== undefined ? String(ap.askTimeoutMinutes) : '',
  }
}
