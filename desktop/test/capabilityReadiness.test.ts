import { describe, it, expect } from 'vitest'
import { capabilityReadiness, BROWSER_MCP_SERVER } from '../src/renderer/lib/capabilityReadiness'
import { BUILTIN_CAPABILITIES } from '../src/renderer/lib/pluginShowcase'
import type { McpServerView } from '../src/shared/types'

/**
 * 「能力概览」角标的实时判定。
 *
 * 症状:用户已经配好搜索后端、agent 也确实抓到了 GitHub 内容,那张
 * 「网页搜索与抓取」卡片仍然挂着黄色「需配置」和整段「搜索需四者之一…」。
 *
 * 根因:角标是 pluginShowcase.ts 里写死的静态标注。当初刻意选静态,理由是
 * 「实时探测探不到会反过来误报」——代价是配好了也永远黄,即反方向的误报,
 * 而且每个配好的用户都会撞上。
 */

const cap = (id: string) => {
  const found = BUILTIN_CAPABILITIES.find(c => c.id === id)
  if (!found) throw new Error('目录里没有这个能力: ' + id)
  return found
}

const server = (over: Partial<McpServerView> = {}): McpServerView => ({
  name: BROWSER_MCP_SERVER, state: 'ready', scope: 'builtin', enabled: true,
  shadowed: false, transport: 'stdio', tools: [], envKeys: [], ...over,
})

describe('capabilityReadiness', () => {
  it('零配置能力仍然是「已内置」灰标', () => {
    const r = capabilityReadiness(cap('files'), { search: null, servers: [] })
    expect(r.state).toBe('builtin')
    expect(r.label).toBe('已内置')
  })

  it('搜索后端已就绪 → 绿标,并说出用的是哪个后端', () => {
    const r = capabilityReadiness(cap('web'), {
      search: { provider: 'searxng', ready: true }, servers: [],
    })
    expect(r.state).toBe('ready')
    expect(r.detail).toContain('searxng')
  })

  it('搜索后端已就绪时不再显示那段「需四者之一」的橙色文案', () => {
    const r = capabilityReadiness(cap('web'), {
      search: { provider: 'zhipu', ready: true }, servers: [],
    })
    expect(r.detail).not.toContain('SERPAPI_KEY')
    expect(r.detail).not.toContain('四者之一')
  })

  it('搜索后端确实没配 → 才给黄标 + 原来那段怎么配', () => {
    const r = capabilityReadiness(cap('web'), {
      search: { provider: 'unconfigured', ready: false }, servers: [],
    })
    expect(r.state).toBe('needs-config')
    expect(r.detail).toContain('SEARXNG')
  })

  it('状态还没拿到时是中性「检测中」,不是黄标 —— 那正是当前这个假角标', () => {
    const r = capabilityReadiness(cap('web'), { search: null, servers: [] })
    expect(r.state).toBe('unknown')
    expect(r.state).not.toBe('needs-config')
  })

  it('浏览器:内置 chrome-devtools MCP 就绪 → 绿标', () => {
    const r = capabilityReadiness(cap('browser'), { search: null, servers: [server()] })
    expect(r.state).toBe('ready')
    expect(r.detail).toContain(BROWSER_MCP_SERVER)
  })

  it('浏览器:MCP 起失败 → 黄标,并把后端给的真实报错带上(比「需装 Node」有用)', () => {
    const r = capabilityReadiness(cap('browser'), {
      search: null, servers: [server({ state: 'error', error: 'spawn npx ENOENT' })],
    })
    expect(r.state).toBe('needs-config')
    expect(r.detail).toContain('spawn npx ENOENT')
  })

  it('浏览器:正在启动 → 检测中,别抖成黄标又跳绿标', () => {
    const r = capabilityReadiness(cap('browser'), { search: null, servers: [server({ state: 'starting' })] })
    expect(r.state).toBe('unknown')
  })

  it('浏览器:被用户停用 → 说「已停用」,不说「需配置」(配置好着呢)', () => {
    const r = capabilityReadiness(cap('browser'), {
      search: null, servers: [server({ state: 'disabled', enabled: false })],
    })
    expect(r.label).toBe('已停用')
  })

  it('浏览器:server 列表还没加载 → 检测中', () => {
    expect(capabilityReadiness(cap('browser'), { search: null, servers: [] }).state).toBe('unknown')
  })

  it('浏览器:列表加载了但用户把 chrome-devtools 删了 / 改名了 → 需配置', () => {
    const r = capabilityReadiness(cap('browser'), {
      search: null, servers: [server({ name: 'filesystem' })],
    })
    expect(r.state).toBe('needs-config')
  })

  it('目录里每一项都能算出状态 —— 不留哑掉的卡片', () => {
    for (const c of BUILTIN_CAPABILITIES) {
      const r = capabilityReadiness(c, { search: { provider: 'searxng', ready: true }, servers: [server()] })
      expect(r.label.length, c.id).toBeGreaterThan(0)
    }
  })
})
