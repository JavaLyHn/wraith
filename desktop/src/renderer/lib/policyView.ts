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
 * best-effort 反转义 JSON-ish 文本:把 \n \t \" \\ \uXXXX 还原成真实字符,让被截断成无效 JSON
 * 的审计 args(write_file 的 content 超 1000 字符即如此)也能读。单遍替换,\\ 正确不误伤。
 */
export function unescapeJsonish(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|[ntr"\\/])/g, (m, esc: string) => {
    if (esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16))
    const map: Record<string, string> = { n: '\n', t: '\t', r: '', '"': '"', '\\': '\\', '/': '/' }
    return map[esc] ?? m
  })
}

/** 从任意文本生成折叠预览字段(首个非空行 + 行数/字符摘要)。 */
function previewFromText(text: string): AuditArgField {
  const lines = text.split('\n')
  const firstNonEmpty = lines.find(l => l.trim() !== '') ?? ''
  const multi = lines.length > 1
  const long = text.length > ARG_PREVIEW_LIMIT
  return {
    key: '',
    value: truncate(firstNonEmpty.trim(), ARG_PREVIEW_LIMIT),
    meta: (multi || long) ? `共 ${lines.length} 行 · ${countLabel(text.length)} 字符` : undefined,
  }
}

/**
 * 把工具参数 JSON 拆成可读字段:每个 key 一行;长/多行字符串(如 write_file 的 content)
 * 只显首个非空行预览 + 「共 N 行 · M 字符」摘要,避免把整段带 \n 转义的正文糊成一坨。
 * 解析失败或非对象 → 单条原始兜底(截断)。
 */
export function auditArgFields(argsJson: string | null | undefined): AuditArgField[] {
  if (!argsJson || !argsJson.trim()) return []
  let obj: unknown
  // 解析失败(常见:content 超 1000 被截成无效 JSON)→ 反转义后按文本预览,而非糊墙原文。
  try { obj = JSON.parse(argsJson) } catch { return [previewFromText(unescapeJsonish(argsJson.trim()))] }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [previewFromText(unescapeJsonish(String(argsJson).trim()))]
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

/**
 * 展开视图用:每字段的**完整**值(不截断),字符串保留真实换行。解析失败(截断的无效 JSON)
 * → 单条反转义全文。用于审计条目点开后看存下的完整参数(受后端 1000 字符上限约束)。
 */
export function auditArgFieldsFull(argsJson: string | null | undefined): AuditArgField[] {
  if (!argsJson || !argsJson.trim()) return []
  let obj: unknown
  try { obj = JSON.parse(argsJson) } catch { return [{ key: '', value: unescapeJsonish(argsJson) }] }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [{ key: '', value: unescapeJsonish(String(argsJson)) }]
  }
  return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: typeof v === 'string' ? v : (JSON.stringify(v, null, 2) ?? String(v)),
  }))
}

/** ISO-8601 → 本地 `MM-DD HH:mm:ss`;解析失败原样返回。 */
export function formatAuditTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
