/** /compact 结果文案(纯函数,可测)。 */

export interface CompactionView {
  compacted: boolean
  beforeTokens: number
  afterTokens: number
  error?: string | null
  summarized?: boolean
  fallback?: string
}

/** token 数 → 紧凑可读:1234→"1.2k",980→"980",1200000→"1.2M"。 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

/** 压缩结果 → 给用户看的中文提示。 */
export function compactionNotice(r: CompactionView): string {
  if (r.error) return `❌ 压缩失败:${r.error}`
  if (!r.compacted) return '上下文未超阈值,无需压缩'
  const range = `${formatTokens(r.beforeTokens)} → ${formatTokens(r.afterTokens)} tokens`
  if (r.fallback && r.beforeTokens === r.afterTokens) return '上下文暂无可压缩内容(摘要不可用,已尝试零成本手段)'
  if (r.fallback) return `⚠️ 摘要暂不可用,已零成本压缩:${range}`
  if (r.summarized) return `✅ 已压缩上下文:${range}(含增量摘要)`
  return `✅ 已压缩上下文:${range}`
}
