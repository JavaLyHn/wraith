import type { PricingEntryView } from '../../shared/types'

/**
 * 这条前缀会命中哪几个已配置模型。
 *
 * 语义与后端 `PricingTable.Entry.matches(exact=false)` / `Main.pricingMatchedModels` 一致：
 * **小写后 startsWith**。用户填 `glm` 会命中 `glm-4.7` 与 `glm-5v-turbo` —— 把这件事显示
 * 出来，前缀语义就不再是静默的。
 *
 * 这是一处刻意的双端重复实现（Java 一份、TS 一份），理由同 `ragView.ts` 的
 * `embeddingDefaults`：为了不为一次 keystroke 发一趟 RPC。**改一边必须改另一边。**
 */
export function matchedModels(prefix: string, configuredModels: string[]): string[] {
  const p = (prefix || '').trim().toLowerCase()
  if (!p) return []
  return configuredModels.filter((m) => (m || '').trim().toLowerCase().startsWith(p))
}

const CURRENCIES = ['CNY', 'USD']

/**
 * 整表校验；返回 null 表示通过，否则是给人看的错误（点名是哪一条，表单要贴在字段旁边）。
 *
 * 规则与后端 `Main.validatePricingEntry` + `applyPricingEntries` 的列表级查重一致 ——
 * 否则用户在一边被拒、在另一边写进去。
 */
export function validateEntries(entries: PricingEntryView[]): string | null {
  const seen = new Set<string>()
  for (const e of entries) {
    const prefix = (e.modelPrefix || '').trim()
    if (!prefix) return '模型前缀不能为空（空前缀会命中所有模型）'
    for (const [label, v] of [
      ['缓存命中', e.cacheHitPerM],
      ['缓存未中', e.cacheMissPerM],
      ['输出', e.outputPerM],
    ] as const) {
      if (!Number.isFinite(v) || v < 0) {
        return `${prefix} 的「${label}」必须是 ≥ 0 的数字（算出负成本比不显示更糟）`
      }
    }
    if (!CURRENCIES.includes((e.currency || '').trim().toUpperCase())) {
      return `${prefix} 的币种只支持 CNY 或 USD（状态栏只认这两种符号）`
    }
    const key = prefix.toLowerCase()
    if (seen.has(key)) return `重复的模型前缀 ${prefix}（两条同名时哪条胜出是任意的）`
    seen.add(key)
  }
  return null
}

/** 与后端 `PricingTable.formatCost` 一致：只有 USD 是 $，其余一律 ¥。 */
export function currencySymbol(currency: string): string {
  return (currency || '').trim().toUpperCase() === 'USD' ? '$' : '¥'
}
