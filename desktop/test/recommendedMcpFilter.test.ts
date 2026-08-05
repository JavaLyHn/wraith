import { describe, it, expect } from 'vitest'
import type { McpServerView } from '../src/shared/types'
import { RECOMMENDED_MCP } from '../src/renderer/lib/pluginShowcase'
import {
  isRecommendationAdded,
  recommendedPackageId,
  stripVersionSuffix,
  unaddedRecommendations,
} from '../src/renderer/lib/recommendedMcpFilter'

/** 只填这条逻辑真正读的字段。 */
function server(partial: Partial<McpServerView> & { name: string }): McpServerView {
  return {
    state: 'ready', scope: 'user', enabled: true, shadowed: false,
    transport: 'stdio', tools: [], envKeys: [],
    ...partial,
  }
}

const rec = (id: string) => RECOMMENDED_MCP.find(m => m.id === id)!

describe('stripVersionSuffix', () => {
  it('**scoped 包只切第二个 @** —— 切第一个会把整个包名切光', () => {
    expect(stripVersionSuffix('@playwright/mcp@latest')).toBe('@playwright/mcp')
    expect(stripVersionSuffix('@modelcontextprotocol/server-memory')).toBe('@modelcontextprotocol/server-memory')
  })
  it('非 scoped 包切第一个 @', () => {
    expect(stripVersionSuffix('mcp-server-fetch@1.2.3')).toBe('mcp-server-fetch')
    expect(stripVersionSuffix('mcp-server-time')).toBe('mcp-server-time')
  })
})

describe('recommendedPackageId', () => {
  it('跳过 -y 这类开关,取真实包名', () => {
    expect(recommendedPackageId(rec('memory'))).toBe('@modelcontextprotocol/server-memory')
    expect(recommendedPackageId(rec('playwright'))).toBe('@playwright/mcp')
  })
  it('**跳过 <占位> 参数** —— 占位符是给用户替换的,拿它比对只会误判', () => {
    // filesystem 的 args 是 ['-y', '@…/server-filesystem', '<允许访问的目录>']
    expect(recommendedPackageId(rec('filesystem'))).toBe('@modelcontextprotocol/server-filesystem')
    // git 的 args 里 --repository 后面跟 <仓库路径>
    expect(recommendedPackageId(rec('git'))).toBe('mcp-server-git')
  })
})

describe('isRecommendationAdded', () => {
  it('**用户实测那一幕**:左栏已有 memory / playwright,推荐区不该再列它们', () => {
    const servers = [server({ name: 'memory' }), server({ name: 'playwright' })]
    expect(isRecommendationAdded(rec('memory'), servers)).toBe(true)
    expect(isRecommendationAdded(rec('playwright'), servers)).toBe(true)
    expect(isRecommendationAdded(rec('fetch'), servers)).toBe(false)
  })

  it('**改了名也认得出** —— 靠包名兜住', () => {
    const servers = [server({
      name: '我的记忆库', command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    })]
    expect(isRecommendationAdded(rec('memory'), servers)).toBe(true)
  })

  it('**版本后缀不同仍算同一个** —— 推荐写 @latest,用户可能没写', () => {
    const servers = [server({ name: 'pw', command: 'npx', args: ['-y', '@playwright/mcp'] })]
    expect(isRecommendationAdded(rec('playwright'), servers)).toBe(true)
  })

  it('停用的也算已装 —— 它还在配置里,重复添加照样撞名', () => {
    const servers = [server({ name: 'memory', state: 'disabled', enabled: false })]
    expect(isRecommendationAdded(rec('memory'), servers)).toBe(true)
  })

  it('不相关的 server 不该顶掉任何推荐', () => {
    const servers = [
      server({ name: 'chrome-devtools', scope: 'builtin', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }),
      server({ name: 'my-thing', command: 'node', args: ['server.js'] }),
    ]
    expect(unaddedRecommendations(servers)).toHaveLength(RECOMMENDED_MCP.length)
  })

  it('**用户把 <占位> 原样留着时不能匹配一切** —— 那个参数不参与比对', () => {
    const servers = [server({ name: 'x', command: 'uvx', args: ['<仓库路径>'] })]
    expect(unaddedRecommendations(servers)).toHaveLength(RECOMMENDED_MCP.length)
  })

  it('http 型 server(没有 command/args)只按名字判,不崩', () => {
    const servers = [server({ name: 'github', transport: 'http', command: undefined, args: undefined })]
    expect(isRecommendationAdded(rec('github'), servers)).toBe(true)
    expect(isRecommendationAdded(rec('git'), servers)).toBe(false)
  })
})

describe('unaddedRecommendations', () => {
  it('一个都没装时全列出来', () => {
    expect(unaddedRecommendations([])).toHaveLength(RECOMMENDED_MCP.length)
  })
  it('装了两个就少两个,且少掉的正是那两个', () => {
    const left = unaddedRecommendations([server({ name: 'memory' }), server({ name: 'playwright' })])
    expect(left).toHaveLength(RECOMMENDED_MCP.length - 2)
    expect(left.map(m => m.id)).not.toContain('memory')
    expect(left.map(m => m.id)).not.toContain('playwright')
    expect(left.map(m => m.id)).toContain('fetch')
  })
  it('全装了就是空 —— 面板据此换成一句说明,而不是留个空网格', () => {
    const all = RECOMMENDED_MCP.map(m => server({ name: m.id }))
    expect(unaddedRecommendations(all)).toHaveLength(0)
  })
})
