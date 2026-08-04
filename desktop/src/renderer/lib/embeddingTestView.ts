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

/**
 * 结果框的描边与底色。**刻意不含任何 `text-*`** —— 见下。
 *
 * 两条都是量出来的：
 *
 * **① 必须走主题令牌，不能写死 Tailwind 调色板。** 初版写的是 `text-emerald-200` 等
 * 暗色主题的浅色文字，在亮色主题下压在近白底上对比度只有 **1.09:1**（WCAG 正文要求
 * ≥4.5:1），用户实测「压根看不清」。
 *
 * **② 换成令牌仍然不够：正文不能用 tone 色。** 那三个令牌是给角标 / 短标签设计的，
 * 压在 `tone/10` 底色上亮色主题只有 `ok 2.93:1` / `warn 2.44:1` / `danger 4.43:1`，
 * 而 `text-fg-muted` 是 4.9~5.2:1、`text-fg` 是 13.3~14.0:1（两个主题都过）。
 * 所以容器这里**不定文字色**，明细行由调用方给 `text-fg-muted`；容器返回了文字色，
 * 明细行就会继承它，又回到看不清。
 */
export function embeddingTestToneClass(tone: 'ok' | 'warn' | 'error'): string {
  switch (tone) {
    case 'ok': return 'border-ok/40 bg-ok/10'
    case 'warn': return 'border-warn/40 bg-warn/10'
    default: return 'border-danger/40 bg-danger/10'
  }
}

/**
 * 标题的文字色。
 *
 * 这里可以用 tone 色：标题短、加粗，而且状态被 emoji（✅/⚠/❌）冗余编码了 ——
 * 即使颜色分辨不出来，信息也没丢。明细行没有这层冗余，所以走正文令牌。
 */
export function embeddingTestTitleClass(tone: 'ok' | 'warn' | 'error'): string {
  switch (tone) {
    case 'ok': return 'text-ok'
    case 'warn': return 'text-warn'
    default: return 'text-danger'
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
