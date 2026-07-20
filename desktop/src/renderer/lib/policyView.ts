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

/** 审计参数的结构化预览字段。key 为空表示无法解析的原始兜底(整串截断)。 */
export interface AuditArgField { key: string; value: string; meta?: string }

const ARG_PREVIEW_LIMIT = 140

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function countLabel(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n)
}

/**
 * 把工具参数 JSON 拆成可读字段:每个 key 一行;长/多行字符串(如 write_file 的 content)
 * 只显首个非空行预览 + 「共 N 行 · M 字符」摘要,避免把整段带 \n 转义的正文糊成一坨。
 * 解析失败或非对象 → 单条原始兜底(截断)。
 */
export function auditArgFields(argsJson: string | null | undefined): AuditArgField[] {
  if (!argsJson || !argsJson.trim()) return []
  let obj: unknown
  try { obj = JSON.parse(argsJson) } catch { return [{ key: '', value: truncate(argsJson.trim(), 200) }] }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [{ key: '', value: truncate(String(argsJson).trim(), 200) }]
  }
  const out: AuditArgField[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const lines = v.split('\n')
      const firstNonEmpty = lines.find(l => l.trim() !== '') ?? ''
      const multi = lines.length > 1
      const long = v.length > ARG_PREVIEW_LIMIT
      out.push({
        key: k,
        value: truncate(firstNonEmpty.trim(), ARG_PREVIEW_LIMIT),
        meta: (multi || long) ? `共 ${lines.length} 行 · ${countLabel(v.length)} 字符` : undefined,
      })
    } else {
      out.push({ key: k, value: truncate(JSON.stringify(v) ?? String(v), ARG_PREVIEW_LIMIT) })
    }
  }
  return out
}

/** ISO-8601 → 本地 `MM-DD HH:mm:ss`;解析失败原样返回。 */
export function formatAuditTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
