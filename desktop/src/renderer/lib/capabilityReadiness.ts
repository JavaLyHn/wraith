import type { McpServerView, SearchStatusView } from '../../shared/types'
import type { BuiltinCapability } from './pluginShowcase'

/**
 * 「能力概览」卡片角标的**实时**判定。
 *
 * 此前角标是 `pluginShowcase.ts` 里写死的 `requires` 静态标注。那个选择当初是刻意的
 * （注释还在那儿：「实时探测一旦探不到就会反过来误报」），但它的代价是**配好了也永远显示
 * 需配置** —— 反方向的误报，而且每个配好的用户都必然撞上：用户已经能搜到 GitHub 内容了，
 * 面板还挂着黄色「需配置」和一整段「搜索需四者之一…」。
 *
 * 现在两项都有真实信号可问，所以改成实时：
 * - 搜索后端 ← 后端 `config.getSearch`（问的是 agent 真正会用的那个 provider 对象）
 * - 浏览器接管 ← 内置 `chrome-devtools` MCP server 的 state（本来就在 servers 里，不必新加 RPC）
 *
 * **探不到时不猜**：状态未知就是 `unknown`（中性「检测中…」），既不假装就绪，
 * 也不退回那个假的黄角标。
 */

export type { SearchStatusView }

export type ReadinessState = 'builtin' | 'ready' | 'needs-config' | 'unknown'

export interface Readiness {
  state: ReadinessState
  /** 角标文字。与 state 解耦：`disabled` 说「已停用」比说「需配置」诚实（配置好着呢）。 */
  label: string
  /** 卡面第二行。needs-config 时是「缺什么」，ready 时是「现在用的是什么」。 */
  detail: string
}

/** 浏览器能力背后的内置 MCP server 名（与 McpConfigLoader.BROWSER_SERVER 一致）。 */
export const BROWSER_MCP_SERVER = 'chrome-devtools'

export function capabilityReadiness(
  capability: BuiltinCapability,
  ctx: { search: SearchStatusView | null; servers: McpServerView[] },
): Readiness {
  if (!capability.requires) {
    return { state: 'builtin', label: '已内置', detail: '' }
  }
  if (capability.id === 'web') {
    return searchReadiness(capability, ctx.search)
  }
  if (capability.id === 'browser') {
    return browserReadiness(capability, ctx.servers)
  }
  // 目录里将来新增的「有前置条件但还没有探测口」的能力：保持静态标注，别假装知道。
  return { state: 'needs-config', label: '需配置', detail: capability.requires }
}

function searchReadiness(capability: BuiltinCapability, search: SearchStatusView | null): Readiness {
  if (search === null) {
    return { state: 'unknown', label: '检测中…', detail: '' }
  }
  if (search.ready) {
    // 抓取(web_fetch)本来就零配置，所以这张卡就绪与否只取决于搜索后端。
    return { state: 'ready', label: '已就绪', detail: `搜索后端：${search.provider}；抓取零配置` }
  }
  return { state: 'needs-config', label: '需配置', detail: capability.requires ?? '' }
}

function browserReadiness(capability: BuiltinCapability, servers: McpServerView[]): Readiness {
  if (servers.length === 0) {
    return { state: 'unknown', label: '检测中…', detail: '' }   // 列表还没拉回来
  }
  const server = servers.find(s => s.name === BROWSER_MCP_SERVER)
  if (!server) {
    return { state: 'needs-config', label: '需配置', detail: capability.requires ?? '' }
  }
  if (server.state === 'starting') {
    return { state: 'unknown', label: '检测中…', detail: '' }   // 别抖成黄标再跳绿标
  }
  if (server.state === 'ready') {
    return { state: 'ready', label: '已就绪', detail: `${BROWSER_MCP_SERVER} MCP 已就绪` }
  }
  if (server.state === 'disabled') {
    return { state: 'needs-config', label: '已停用', detail: `${BROWSER_MCP_SERVER} MCP 已停用，启用后即可用` }
  }
  // error：后端给的原文比「需装有 Node 与 Chrome」有用得多（spawn npx ENOENT 一眼定位）
  return {
    state: 'needs-config',
    label: '需配置',
    detail: server.error ? `${BROWSER_MCP_SERVER} 启动失败：${server.error}` : (capability.requires ?? ''),
  }
}

/** 角标配色。unknown 与 builtin 都用中性色 —— 未知不该长得像「出问题了」。 */
export function readinessBadgeClass(state: ReadinessState): string {
  if (state === 'ready') return 'bg-ok/15 text-ok'
  if (state === 'needs-config') return 'bg-warn/15 text-warn'
  return 'bg-surface text-fg-subtle'
}
