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
// 保存失败原因透出(把 daemon 权威错误 message 清洗成人话)
// ---------------------------------------------------------------------------

/**
 * 从保存(upsert)抛出的异常里提取可读原因,拼成「保存失败:<原因>」。
 * 会剥掉 Electron `ipcRenderer.invoke` 包的 "Error invoking remote method
 * '...': Error: " 前缀,只留 daemon/主进程给的权威消息(如「非法 cron 表达式: ...」
 * 「Backend not connected」)。消息为空时兜底为「保存失败」。
 */
export function saveErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const reason = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim()
  return reason ? `保存失败:${reason}` : '保存失败'
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

/** 投递平台 → 中文标签(展示 + 勾选项共用)。IM 平台取短名。未知平台回落 id 本身。 */
const DELIVERY_LABELS: Record<string, string> = {
  desktop: '桌面通知', qq: 'QQ 消息', feishu: '飞书', wecom: '企业微信', weixin: '微信',
}
export function deliveryPlatformLabel(platform: string): string {
  return DELIVERY_LABELS[platform] ?? platform
}

/** 投递目标数组 → 简短中文描述列表(用于展示)。 */
export function deliveryTargetsToLabels(targets: DeliveryTarget[]): string[] {
  return targets.map(t => deliveryPlatformLabel(t.platform))
}

// ---------------------------------------------------------------------------
// AutomationForm parse/build helpers(从 AutomationForm.tsx 提取,纯函数)
// ---------------------------------------------------------------------------

/** 解析 initial.deliverTo → 已选平台 id 集合;新建任务默认 {desktop}。 */
export function parseDeliverTo(initial: AutomationTask | null): Set<string> {
  if (!initial || !initial.deliverTo || initial.deliverTo.length === 0) {
    return new Set(['desktop'])
  }
  return new Set(initial.deliverTo.map(d => d.platform))
}

/** 平台 id 序列 → DeliveryTarget[](保持传入顺序,便于 UI 稳定输出)。 */
export function buildDeliverTo(platforms: Iterable<string>): DeliveryTarget[] {
  return Array.from(platforms).map(p => ({ platform: p }))
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
    // != null 同时挡 undefined 与 JSON null(否则 String(null)==="null" 会漏进 UI,如「超时 null 分」)
    askTimeoutMinutes: ap.askTimeoutMinutes != null ? String(ap.askTimeoutMinutes) : '',
  }
}
