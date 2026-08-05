// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PluginsPanel from '../src/renderer/components/PluginsPanel'
import { RECOMMENDED_MCP } from '../src/renderer/lib/pluginShowcase'
import type { McpServerView } from '../src/shared/types'

/**
 * 推荐区不该再列<b>已经装好</b>的 MCP。
 *
 * <p>用户实测：左栏已经有 `memory`(用户) 和 `playwright`(用户)，
 * 而下面「推荐 MCP · 一键添加」里 Memory 和 Playwright 仍并列摆着「＋ 添加」。
 * 点下去只会得到一个重名冲突 —— 推荐区的语义是「你还可以加什么」，不是目录。
 *
 * <p>判定逻辑与它的单测在 `recommendedMcpFilter.test.ts`；这里守的是<b>面板接线</b>
 * （把 `RECOMMENDED_MCP.map` 换成 `unadded.map` 这一步很容易在改版时被还原）。
 */

function stubBackend(): void {
  ;(window as unknown as { wraith: unknown }).wraith = {
    configGetSearch: async () => ({ configured: false, provider: '', detail: '' }),
  }
}

afterEach(() => {
  // cleanup 不能省:少了它,上一条的 DOM 会留下来,后面 queryByTestId 查到重复节点
  // 而不是 null —— 第一版就这么假红了三条。
  cleanup()
  delete (window as unknown as { wraith?: unknown }).wraith
})

function server(name: string, over: Partial<McpServerView> = {}): McpServerView {
  return {
    name, state: 'ready', scope: 'user', enabled: true, shadowed: false,
    transport: 'stdio', tools: [], envKeys: [], ...over,
  }
}

function props(servers: McpServerView[]): React.ComponentProps<typeof PluginsPanel> {
  return {
    servers, configError: null, busy: false,
    onBack: () => {}, onRefresh: () => {}, onToggle: () => {},
    onRestart: () => {}, onRemove: () => {}, onSubmitForm: async () => true,
  }
}

describe('推荐 MCP 区', () => {
  it('**装过的不再出现,没装的照旧** —— 用户截图那一幕', () => {
    stubBackend()
    render(<PluginsPanel {...props([server('memory'), server('playwright')])} />)

    expect(screen.queryByTestId('mcp-rec-add-memory')).toBeNull()
    expect(screen.queryByTestId('mcp-rec-add-playwright')).toBeNull()
    // 没装的必须还在,否则就是把整个区域一起藏了
    expect(screen.queryByTestId('mcp-rec-add-fetch')).not.toBeNull()
    expect(screen.queryByTestId('mcp-rec-add-github')).not.toBeNull()
  })

  it('一个都没装时,八个推荐全在', () => {
    stubBackend()
    render(<PluginsPanel {...props([])} />)
    for (const m of RECOMMENDED_MCP) {
      expect(screen.queryByTestId(`mcp-rec-add-${m.id}`), `${m.id} 该显示`).not.toBeNull()
    }
    expect(screen.queryByTestId('mcp-rec-all-added')).toBeNull()
  })

  it('全装完时换成一句说明,而不是留一个空网格', () => {
    stubBackend()
    render(<PluginsPanel {...props(RECOMMENDED_MCP.map(m => server(m.id)))} />)

    expect(screen.queryByTestId('mcp-rec-all-added')).not.toBeNull()
    for (const m of RECOMMENDED_MCP) {
      expect(screen.queryByTestId(`mcp-rec-add-${m.id}`)).toBeNull()
    }
  })

  it('改了名装的也认得出 —— 靠包名,不只靠名字', () => {
    stubBackend()
    render(<PluginsPanel {...props([
      server('我的记忆库', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }),
    ])} />)

    expect(screen.queryByTestId('mcp-rec-add-memory')).toBeNull()
    expect(screen.queryByTestId('mcp-rec-add-fetch')).not.toBeNull()
  })
})
