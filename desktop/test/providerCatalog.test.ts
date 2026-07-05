import { describe, it, expect } from 'vitest'
import { PROVIDER_CATALOG, findCatalogEntry } from '../src/shared/providerCatalog'

describe('PROVIDER_CATALOG', () => {
  it('每条 id 唯一,defaultBaseUrl 非空,protocol 合法', () => {
    const ids = new Set<string>()
    for (const e of PROVIDER_CATALOG) {
      expect(ids.has(e.id)).toBe(false); ids.add(e.id)
      expect(e.defaultBaseUrl.length).toBeGreaterThan(0)
      expect(['openai', 'anthropic']).toContain(e.protocol)
      expect(e.suggestedModels.length).toBeGreaterThan(0)
    }
  })
  it('别名不与任何 id 冲突,且可反查', () => {
    const ids = new Set(PROVIDER_CATALOG.map(e => e.id))
    for (const e of PROVIDER_CATALOG)
      for (const a of e.aliases ?? []) expect(ids.has(a)).toBe(false)
    expect(findCatalogEntry('zhipu')?.id).toBe('glm')       // alias 反查
    expect(findCatalogEntry('anthropic')?.protocol).toBe('anthropic')
    expect(findCatalogEntry('不存在')).toBeUndefined()
  })
  it('含 Anthropic 且协议正确、含 Wraith 独有 builtin', () => {
    expect(findCatalogEntry('anthropic')).toBeTruthy()
    expect(PROVIDER_CATALOG.some(e => e.builtin && e.id === 'xfyun')).toBe(true)
  })
})
