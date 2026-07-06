/**
 * 插件「能力概览」目录:
 * - BUILTIN_CAPABILITIES —— Wraith 开箱即用的内置能力,按 ToolRegistry 真实工具归类(信息展示,不可增删)。
 * - RECOMMENDED_MCP —— 官方/主流 MCP server 的真实 stdio 安装命令,「添加」时预填 McpServerForm。
 *
 * 内置工具名与 src/main/java/com/lyhn/wraith/tool/ToolRegistry.java 保持一致。
 * 推荐 MCP 命令取自 modelcontextprotocol/servers 与官方发行渠道;含 <占位> 的参数需用户替换为真实值。
 */

export interface BuiltinCapability {
  id: string
  icon: string
  name: string
  desc: string
  tools: string[] // 背后真实内置工具名
}

export interface RecommendedMcp {
  id: string
  icon: string
  name: string
  desc: string
  command: string // stdio 命令(npx / uvx …)
  args: string[]  // 命令参数;<占位> 需用户替换
  envKeys?: string[] // 需用户填写的环境变量(预填空值行 + 提示)
  note?: string      // 补充说明(如需替换的占位)
}

export const BUILTIN_CAPABILITIES: BuiltinCapability[] = [
  { id: 'files', icon: '📄', name: '文件读写', desc: '读取与写入项目文件', tools: ['read_file', 'write_file'] },
  { id: 'search', icon: '🔍', name: '代码搜索', desc: '按内容 / 文件名 / 目录检索代码', tools: ['grep_code', 'glob_files', 'search_code', 'list_dir'] },
  { id: 'exec', icon: '⌨️', name: '执行命令', desc: '在沙箱内运行 shell 命令', tools: ['execute_command'] },
  { id: 'project', icon: '📦', name: '新建项目', desc: '脚手架创建新项目', tools: ['create_project'] },
  { id: 'web', icon: '🌐', name: '网页搜索与抓取', desc: '联网搜索并抓取网页内容', tools: ['web_search', 'web_fetch'] },
  { id: 'browser', icon: '🖥️', name: '浏览器接管', desc: '连接并驱动本地浏览器', tools: ['browser_connect', 'browser_disconnect', 'browser_status'] },
  { id: 'skill', icon: '🧩', name: '技能加载', desc: '按需加载 Skill 扩展能力', tools: ['load_skill'] },
  { id: 'memory', icon: '🧠', name: '长期记忆', desc: '保存跨会话记忆', tools: ['save_memory'] },
  { id: 'todo', icon: '✅', name: '任务清单', desc: '拆解与跟踪多步任务', tools: ['todo_write'] },
]

export const RECOMMENDED_MCP: RecommendedMcp[] = [
  {
    id: 'filesystem', icon: '📁', name: 'Filesystem', desc: '读写指定目录的文件',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<允许访问的目录>'],
    note: '把 <允许访问的目录> 换成实际路径',
  },
  {
    id: 'fetch', icon: '🌐', name: 'Fetch', desc: '抓取网页并转为 Markdown',
    command: 'uvx', args: ['mcp-server-fetch'],
  },
  {
    id: 'git', icon: '🌿', name: 'Git', desc: '读取/操作 Git 仓库',
    command: 'uvx', args: ['mcp-server-git', '--repository', '<仓库路径>'],
    note: '把 <仓库路径> 换成实际仓库目录',
  },
  {
    id: 'memory', icon: '💾', name: 'Memory', desc: '知识图谱式长期记忆',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'sequential-thinking', icon: '🔁', name: 'Sequential Thinking', desc: '分步推理脚手架',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'time', icon: '⏰', name: 'Time', desc: '时间与时区换算',
    command: 'uvx', args: ['mcp-server-time'],
  },
  {
    id: 'playwright', icon: '🎭', name: 'Playwright', desc: '浏览器自动化(Microsoft)',
    command: 'npx', args: ['-y', '@playwright/mcp@latest'],
  },
  {
    id: 'github', icon: '🐙', name: 'GitHub', desc: '读写 issue / PR / 仓库',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    note: '需在环境变量填入 GitHub 访问令牌',
  },
]
