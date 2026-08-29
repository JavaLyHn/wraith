import {
  Blocks, Plug, BookOpen, Activity, Clock, MessageSquare, ListTodo, Brain,
  History, Shield, Globe, ScanSearch, FolderOpen, ListTree, Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * 侧栏工具导航分组配置。
 * 分组依据是「什么时候会点它」,不是功能相似:
 *   配置 — 装好一次,几周不动;改完就走,不看结果
 *   运行 — 有东西在后台跑着,想看它怎么样了;有状态、会变、可能带红点
 *   观察 — 出事了回头查;只读为主,查完就关
 *   资料 — 我的东西(文档/文件)
 *
 * 附带的好处:红点只可能出现在「运行」组,眼睛知道往哪儿扫。
 * 11 项平铺时扫一遍要过 11 行。这里只加小标题、不做逐组折叠 —— 分段是为了扫得快,
 * 不是为了藏起来;「工具」本身已能整体折叠,再套一层只会给每次点击多加一步。
 */
export type ToolNav = 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents'
  | 'activity' | 'workspace'

export interface ToolGroup {
  label: string
  items: { nav: ToolNav; testId: string; label: string; Icon: LucideIcon }[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    label: '配置',
    items: [
      { nav: 'plugins', testId: 'nav-plugins', label: 'MCP', Icon: Blocks },
      { nav: 'providers', testId: 'nav-providers', label: 'Provider 配置', Icon: Plug },
      { nav: 'skills', testId: 'nav-skills', label: '技能', Icon: BookOpen },
    ],
  },
  {
    label: '运行',
    items: [
      { nav: 'activity', testId: 'nav-activity', label: '活动', Icon: Activity },
      { nav: 'automations', testId: 'nav-automations', label: '自动化', Icon: Clock },
      { nav: 'im-gateway', testId: 'nav-im-gateway', label: 'IM 网关', Icon: MessageSquare },
      { nav: 'tasks', testId: 'nav-tasks', label: '后台任务', Icon: ListTodo },
    ],
  },
  {
    label: '观察',
    items: [
      { nav: 'memory', testId: 'nav-memory', label: '记忆', Icon: Brain },
      { nav: 'snapshots', testId: 'nav-snapshots', label: '快照', Icon: History },
      // 中性盾:状态语义(ok/未启用)由顶栏那个盾承担,这里只是分类图标,别用带勾的
      { nav: 'policy', testId: 'nav-policy', label: '安全', Icon: Shield },
      { nav: 'browser', testId: 'nav-browser', label: '浏览器', Icon: Globe },
      { nav: 'rag', testId: 'nav-rag', label: '代码检索', Icon: ScanSearch },
    ],
  },
  {
    // 前三组讲的是「agent 怎么工作」,这一组是「我的东西」——塞进任何一组
    // 都会让那组的分类依据失效,所以单开。目前一项,后续剪藏/归档也归这里。
    label: '资料',
    items: [
      { nav: 'documents', testId: 'nav-documents', label: '文档', Icon: FolderOpen },
      { nav: 'workspace', testId: 'nav-workspace', label: '文件', Icon: ListTree },
    ],
  },
]

/** 分组折叠/展开状态:默认进入「配置」,用户展开「运行」「观察」后保持记忆。 */
export const TOOL_GROUP_DEFAULT_EXPANDED: Record<string, boolean> = {
  '配置': true,
  '运行': false,
  '观察': false,
  '资料': false,
}

export const SIDEBAR_TOOLS_ICON = Wrench
