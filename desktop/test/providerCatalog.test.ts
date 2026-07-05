import { describe, it, expect } from 'vitest'
import { PROVIDER_CATALOG, findCatalogEntry, baseProviderId, nextInstanceId, instanceDisplayName } from '../src/shared/providerCatalog'

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

describe('provider instance helpers', () => {
  it('freellmapi 标记 repeatable', () => {
    expect(findCatalogEntry('freellmapi')?.repeatable).toBe(true)
    expect(findCatalogEntry('openai')?.repeatable).toBeFalsy()
  })
  it('baseProviderId 只剥离末尾数字后缀', () => {
    expect(baseProviderId('freellmapi')).toBe('freellmapi')
    expect(baseProviderId('freellmapi-2')).toBe('freellmapi')
    expect(baseProviderId('freellmapi-13')).toBe('freellmapi')
    expect(baseProviderId('baidu-cloud')).toBe('baidu-cloud')      // 非数字后缀不动
    expect(baseProviderId('zhipu-coding')).toBe('zhipu-coding')
  })
  it('nextInstanceId 首个裸 id,之后取最小空位', () => {
    expect(nextInstanceId('freellmapi', new Set())).toBe('freellmapi')
    expect(nextInstanceId('freellmapi', new Set(['freellmapi']))).toBe('freellmapi-2')
    expect(nextInstanceId('freellmapi', new Set(['freellmapi', 'freellmapi-2']))).toBe('freellmapi-3')
    // 填补空洞:占用 base 与 -3,应回 -2
    expect(nextInstanceId('freellmapi', new Set(['freellmapi', 'freellmapi-3']))).toBe('freellmapi-2')
  })
  it('instanceDisplayName:label 优先,否则 base / #N', () => {
    const e = findCatalogEntry('freellmapi')!
    expect(instanceDisplayName('freellmapi', '工作号', e)).toBe('FreeLLMAPI · 工作号')
    expect(instanceDisplayName('freellmapi', undefined, e)).toBe('FreeLLMAPI')
    expect(instanceDisplayName('freellmapi', '', e)).toBe('FreeLLMAPI')
    expect(instanceDisplayName('freellmapi-2', undefined, e)).toBe('FreeLLMAPI #2')
    expect(instanceDisplayName('freellmapi-2', '备用', e)).toBe('FreeLLMAPI · 备用')
    expect(instanceDisplayName('unknown-x', undefined, undefined)).toBe('unknown-x')
  })
})
