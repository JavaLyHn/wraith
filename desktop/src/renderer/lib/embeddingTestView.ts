import type { EmbeddingTestResult } from '../../shared/types'

/** 毫秒 → 人读的时长（探测都在秒级以内，所以比 ragView 那个更细）。 */
function humanLatency(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}

/**
 * 「测试连接」结果摊成几行。
 *
 * **成功**时摊开的每一项都有理由：
 * - **维度** —— 与索引维度不一致时检索会报错，这是建索引**之前**唯一一次能看见它的机会；
 * - **耗时** —— 单次 × 上千块 = 整库索引的量级（ollama 首次请求含把模型载进内存的时间）；
 * - **provider / model / baseUrl** —— 回显的是**实际生效**的那套：表单留空时后端会填默认值。
 *
 * **失败**时诊断在前、原文在后，**两个都留着**。「连不上」「401 key 错」「429 限流」
 * 是三件不同的事，只给一句友好话会把人引到错的地方去查。
 *
 * 缺的字段整行不出现（旧 jar 不回这些字段），绝不显示「维度 undefined」。
 */
export function embeddingTestLines(r: EmbeddingTestResult): string[] {
  const lines: string[] = []
  if (!r.ok) {
    if (r.hint) lines.push(r.hint)
    if (r.error) lines.push(r.error)
    if (lines.length === 0) lines.push('测试失败，但后端没有给出原因。')
    return lines
  }
  if (typeof r.dim === 'number') lines.push(`向量维度 ${r.dim}`)
  if (typeof r.latencyMs === 'number') lines.push(`单次耗时 ${humanLatency(r.latencyMs)}`)
  if (r.model) lines.push(`实际使用模型 ${r.model}`)
  if (r.provider) lines.push(`provider ${r.provider}`)
  if (r.baseUrl) lines.push(`地址 ${r.baseUrl}`)
  if (r.warning) lines.push(r.warning)
  return lines
}

/**
 * 三态，不是两态。
 *
 * `warn` = **后端是通的，但与现有索引不兼容**。这一态必须与 `ok` 分开：
 * 给个绿勾加一行小字，用户只会看见绿勾，然后带着不兼容的索引去检索
 * （维度不同会报错；同维度不同模型连错都不报，只是结果全是垃圾）。
 */
export function embeddingTestTone(r: EmbeddingTestResult): 'ok' | 'warn' | 'error' {
  if (!r.ok) return 'error'
  return r.warning ? 'warn' : 'ok'
}

/** 三态对应的样式（与面板其余提示框同一套配色）。 */
export function embeddingTestToneClass(tone: 'ok' | 'warn' | 'error'): string {
  switch (tone) {
    case 'ok': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    case 'warn': return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    default: return 'border-red-500/40 bg-red-500/10 text-red-200'
  }
}

/** 三态的标题。 */
export function embeddingTestTitle(tone: 'ok' | 'warn' | 'error'): string {
  switch (tone) {
    case 'ok': return '✅ 连接正常'
    case 'warn': return '⚠ 后端可用，但与现有索引不兼容'
    default: return '❌ 连接失败'
  }
}
