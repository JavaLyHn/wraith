/** 安全策略/审计的展示辅助(纯函数,可单测)。 */

export function outcomeLabel(outcome: string): string {
  if (outcome === 'allow') return '允许'
  if (outcome === 'deny') return '拒绝'
  if (outcome === 'error') return '错误'
  return outcome
}

export function approverLabel(approver: string | null | undefined): string {
  if (!approver) return ''
  if (approver === 'hitl') return '人工'
  if (approver === 'policy') return '策略'
  if (approver === 'none') return '自动'
  if (approver === 'mention') return '提及'
  return approver
}

/** ISO-8601 → 本地 `MM-DD HH:mm:ss`;解析失败原样返回。 */
export function formatAuditTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
