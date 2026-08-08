import { filterSidebar, type SessionFilterItem } from './sidebarSearch'
import type { PanelId } from './panelActions'
import type { ProjectView } from '../../shared/types'

export type PaletteGroup = 'session' | 'project' | 'command' | 'nav'
export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string        // 快捷键提示文案,如 '⌘N'
  action: string       // 'session:<id>' | 'project:<path>' | 'new' | 'settings' | 'view:<view>'
}

/**
 * ⌘K 的「导航」组 —— **每个功能面板都必须在这里登记一行**,否则该面板从 ⌘K 搜不到,
 * 而其余面板都搜得到,用户只会当成 bug(「文档」面板首版就漏了这里)。
 * label 用面板在 ⌘K 里的检索友好名,可以与侧栏/动作卡的 PANEL_LABELS 不同(如 插件 (MCP))。
 */
const NAV_ITEMS = [
  { view: 'projects', label: '项目' },
  { view: 'plugins', label: '插件 (MCP)' },
  { view: 'automations', label: '自动化' },
  { view: 'im-gateway', label: 'IM 网关' },
  { view: 'providers', label: 'Provider 配置' },
  { view: 'skills', label: '技能' },
  { view: 'memory', label: '记忆' },
  { view: 'snapshots', label: '快照' },
  { view: 'tasks', label: '后台任务' },
  { view: 'policy', label: '策略' },
  { view: 'browser', label: '浏览器' },
  { view: 'rag', label: 'RAG' },
  { view: 'documents', label: '文档' },
] as const satisfies readonly { view: PanelId; label: string }[]

/**
 * 编译期兜底:漏登记任何一个 PanelId,下面这行就报错(而不是等用户发现 ⌘K 搜不到)。
 * `view` 从前是裸 `string`,所以漏了「文档」tsc 也照过 —— 这就是那个缺口的补丁。
 * 真要让某个面板故意不进 ⌘K,请从 Exclude 里显式排除它并写清理由。
 */
export type NavCoversEveryPanel =
  Exclude<PanelId, (typeof NAV_ITEMS)[number]['view']> extends never ? true : never
const _navCoversEveryPanel: NavCoversEveryPanel = true
void _navCoversEveryPanel

/** 固定命令 + 导航项(与查询无关)。 */
export function buildStaticItems(): PaletteItem[] {
  return [
    { id: 'cmd:new', group: 'command', label: '新对话', hint: '⌘N', action: 'new' },
    { id: 'cmd:settings', group: 'command', label: '设置', hint: '⌘,', action: 'settings' },
    ...NAV_ITEMS.map(n => ({ id: 'nav:' + n.view, group: 'nav' as PaletteGroup, label: n.label, action: 'view:' + n.view })),
  ]
}

const hit = (label: string, q: string): boolean => label.toLowerCase().includes(q)

/** 按 query 过滤 → 分组(非空才出)+ 扁平有序列表(供 ↑↓ 与 ⌘1–9)。 */
export function filterPalette(
  query: string,
  sessions: SessionFilterItem[],
  projects: ProjectView[],
  staticItems: PaletteItem[],
): { groups: { title: string; items: PaletteItem[] }[]; flat: PaletteItem[] } {
  const q = query.trim().toLowerCase()
  const fs = filterSidebar(sessions, projects, query)
  const sessionItems: PaletteItem[] = fs.sessions.map(s => ({
    id: 'session:' + s.id, group: 'session', label: s.title || '未命名', action: 'session:' + s.id,
  }))
  const projectItems: PaletteItem[] = fs.projects.map(p => ({
    id: 'project:' + p.path, group: 'project',
    label: p.name || p.path.split('/').filter(Boolean).pop() || p.path, action: 'project:' + p.path,
  }))
  const cmds = staticItems.filter(i => i.group === 'command' && (!q || hit(i.label, q)))
  const navs = staticItems.filter(i => i.group === 'nav' && (!q || hit(i.label, q)))
  const groups = [
    { title: '会话', items: sessionItems },
    { title: '项目', items: projectItems },
    { title: '命令', items: cmds },
    { title: '导航', items: navs },
  ].filter(g => g.items.length > 0)
  return { groups, flat: groups.flatMap(g => g.items) }
}
