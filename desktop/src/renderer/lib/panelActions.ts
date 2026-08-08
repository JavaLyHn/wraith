/**
 * panelActions —— 纯 TS,无 React/Electron 依赖。
 * 面板 id ↔ 中文名映射 + LLM 传入 panel 参数的归一化(mcp→plugins)。
 * 与 App.tsx 的 setView / Sidebar 的 activeNav 对齐。
 */

export type PanelId =
  | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'tasks' | 'policy' | 'browser' | 'rag' | 'documents' | 'projects'

export const PANEL_LABELS: Record<PanelId, string> = {
  plugins: 'MCP',
  automations: '自动化',
  'im-gateway': 'IM 网关',
  providers: 'Provider 配置',
  skills: '技能',
  memory: '记忆',
  snapshots: '快照',
  tasks: '后台任务',
  policy: '安全',
  browser: '浏览器',
  rag: '代码检索',
  documents: '文档',
  projects: '项目',
}

/** LLM 传入 panel 参数归一:trim + 小写,别名 mcp→plugins;非法返回 null。 */
export function normalizePanel(raw: string): PanelId | null {
  const s = (raw || '').trim().toLowerCase()
  const alias = s === 'mcp' ? 'plugins' : s
  return Object.prototype.hasOwnProperty.call(PANEL_LABELS, alias) ? (alias as PanelId) : null
}
