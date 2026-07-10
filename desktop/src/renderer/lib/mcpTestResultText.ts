import type { McpTestResult } from '../../shared/types'

/** mcp 测试回包 → 表单结果行文案。ok 缺字段兜底 0;err 缺 error 显「未知错误」。 */
export function formatMcpTestResult(r: McpTestResult): { kind: 'ok' | 'err'; text: string } {
  if (r.ok) return { kind: 'ok', text: `✅ 连接成功 · ${r.toolCount ?? 0} 个工具 · ${r.latencyMs ?? 0}ms` }
  return { kind: 'err', text: `❌ 连接失败:${r.error || '未知错误'}` }
}
