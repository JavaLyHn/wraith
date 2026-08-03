import { describe, it, expect } from 'vitest'
import { matchedModels, validateEntries, currencySymbol } from '../src/renderer/lib/pricingView'
import type { PricingEntryView } from '../src/shared/types'

function entry(over: Partial<PricingEntryView> = {}): PricingEntryView {
  return { modelPrefix: 'm', cacheHitPerM: 1, cacheMissPerM: 1, outputPerM: 1, currency: 'CNY', ...over }
}

// 后端 PricingTable 里 config 条目是前缀匹配、种子要求精确相等。这里复制的是**前缀**那一支
// (面板只编辑 config 条目)。这是一处刻意的双端重复实现,理由同 ragView.ts 的 embeddingDefaults:
// 为了不为一次 keystroke 发一趟 RPC。**改一边必须改另一边** —— 对应的 Java 侧是
// Main.pricingMatchedModels 与 PricingTable.Entry.matches(exact=false)。
describe('matchedModels', () => {
  const models = ['glm-4.7', 'glm-5v-turbo', 'Qwen/Qwen3-8B', 'deepseek-v4-pro']

  it('前缀命中多个 —— 这正是要显示给用户看的那件事', () => {
    expect(matchedModels('glm', models)).toEqual(['glm-4.7', 'glm-5v-turbo'])
  })

  it('完整模型名只命中自己', () => {
    expect(matchedModels('glm-4.7', models)).toEqual(['glm-4.7'])
  })

  it('大小写不敏感', () => {
    expect(matchedModels('qwen/', models)).toEqual(['Qwen/Qwen3-8B'])
    expect(matchedModels('DEEPSEEK', models)).toEqual(['deepseek-v4-pro'])
  })

  it('命中 0 个时是空数组，不是抛错', () => {
    expect(matchedModels('gpt-', models)).toEqual([])
  })

  it('空前缀不命中任何东西 —— 空前缀在后端会命中所有模型,但那是校验该拦的事', () => {
    expect(matchedModels('', models)).toEqual([])
    expect(matchedModels('   ', models)).toEqual([])
  })
})

describe('validateEntries', () => {
  it('合法表通过', () => {
    expect(validateEntries([entry({ modelPrefix: 'a' }), entry({ modelPrefix: 'b' })])).toBeNull()
  })

  it('空表合法 —— 用户可以把计价全删掉', () => {
    expect(validateEntries([])).toBeNull()
  })

  it('空前缀被拒 —— 空前缀会命中所有模型', () => {
    expect(validateEntries([entry({ modelPrefix: '' })])).toBeTruthy()
    expect(validateEntries([entry({ modelPrefix: '   ' })])).toBeTruthy()
  })

  it('负价被拒 —— 算出负成本比不显示更糟', () => {
    expect(validateEntries([entry({ cacheHitPerM: -1 })])).toBeTruthy()
    expect(validateEntries([entry({ outputPerM: -0.1 })])).toBeTruthy()
  })

  it('非有限数被拒', () => {
    expect(validateEntries([entry({ cacheMissPerM: NaN })])).toBeTruthy()
    expect(validateEntries([entry({ outputPerM: Infinity })])).toBeTruthy()
  })

  it('0 价合法 —— 确实有免费模型', () => {
    expect(validateEntries([entry({ cacheHitPerM: 0, cacheMissPerM: 0, outputPerM: 0 })])).toBeNull()
  })

  it('非法币种被拒 —— 状态栏只认 CNY/USD,填 EUR 会一律显示成 ¥', () => {
    expect(validateEntries([entry({ currency: 'EUR' })])).toBeTruthy()
  })

  it('重复前缀被拒（忽略大小写）—— 两条同名时哪条胜出是任意的', () => {
    const dup = validateEntries([entry({ modelPrefix: 'glm-4.7' }), entry({ modelPrefix: 'GLM-4.7' })])
    expect(dup).toBeTruthy()
    expect(dup).toMatch(/glm-4\.7/i)
  })

  it('报错文本点名是哪一条 —— 表单要把它贴在字段旁边', () => {
    expect(validateEntries([entry({ modelPrefix: 'my-model', outputPerM: -1 })])).toMatch(/my-model/)
  })
})

describe('currencySymbol', () => {
  it('只有 USD 是 $，其余都是 ¥（与后端 formatCost 一致）', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('usd')).toBe('$')
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('')).toBe('¥')
  })
})
