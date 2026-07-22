/**
 * artifactSummary — 纯 TS,从 transcript items 派生「本会话产物摘要」。
 * 无 React/Electron 依赖,可单测。四段:输出(文件+服务)/子智能体/浏览器/来源。
 */
import type { Item, ToolCard } from './transcriptReducer'

export interface ArtifactFile { path: string; kind: 'created' | 'modified'; content: string }
export interface ArtifactServer { url: string }
export interface ArtifactSource { path: string; name: string; kind: string }
export interface ArtifactSummary {
  files: ArtifactFile[]
  servers: ArtifactServer[]
  subagents: { total: number; done: number; roles: string[] } | null
  browserUrl: string | null
  sources: ArtifactSource[]
  workspace: string | null
  isEmpty: boolean
}

/** 右侧「预览」pane 展示的产物快照(文件路径 + agent 写入时的完整内容)。 */
export interface PreviewArtifact { filePath: string; content: string }

// 回环地址(本地 dev server / 预览):可选 http(s):// 前缀 + localhost|127.0.0.1 + 必须带端口。
const LOOPBACK_RE = /(?<![\w.-])(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s'"`]*)?/gi
// 任意 http(s) URL(浏览器活动从 output 兜底抽)。
const HTTP_RE = /https?:\/\/[^\s'"`]+/i

/** 归一化回环 URL:去尾部标点与尾斜杠、补 http:// 前缀,便于去重。 */
function normalizeLoopback(raw: string): string {
  let u = raw.trim().replace(/[),.;'"]+$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  return u
}

/** 浏览器工具 argsJson 里的目标 URL(仅导航类工具会带,如 navigate_page/new_page);无则 null。 */
function browserArgUrl(card: ToolCard): string | null {
  try {
    const args = JSON.parse(card.argsJson) as Record<string, unknown>
    if (typeof args['url'] === 'string' && args['url'].trim()) return args['url'].trim()
  } catch { /* 非 JSON,忽略 */ }
  return null
}

/** 非导航类浏览器工具(状态/连接查询),其 output 里的 URL 常是 CDP 端点,不能当导航目标。 */
function isNonNavBrowserTool(name: string): boolean {
  return /(?:status|connect|disconnect)$/.test(name)
}

/**
 * write_file 工具卡的 {path, content}:把"本会话写过的文件"计入产物,**包含内容未变、
 * 后端 no-op 判定而不发 diff 的重写**(否则重复生成同内容文件会显示"暂无产物")。
 * ok===false(被 HITL 拒绝/策略拦截/失败)或参数非法 → null,不计。
 */
function writeFileArgs(card: ToolCard): { path: string; content: string } | null {
  if (card.name !== 'write_file' || card.ok === false) return null
  try {
    const args = JSON.parse(card.argsJson) as Record<string, unknown>
    const path = args['path']
    if (typeof path === 'string' && path) {
      return { path, content: typeof args['content'] === 'string' ? args['content'] : '' }
    }
  } catch { /* 非 JSON,忽略 */ }
  return null
}

/**
 * 从 items 提取「产物文件」:write_file 工具卡(含 no-op 重写,ok!==false)与 diff 合并;
 * diff 决定 created/modified(before==='' 为新建且不降级),content 取最新;按 path 去重保序。
 */
export function deriveFiles(items: readonly Item[]): ArtifactFile[] {
  const files = new Map<string, ArtifactFile>()
  for (const item of items) {
    if (item.type === 'diff') {
      if (item.filePath) {
        const existing = files.get(item.filePath)
        const created = item.before === '' || existing?.kind === 'created'
        files.set(item.filePath, { path: item.filePath, kind: created ? 'created' : 'modified', content: item.after })
      }
    } else if (item.type === 'tool') {
      const wf = writeFileArgs(item.card)
      if (wf) {
        const existing = files.get(wf.path)
        files.set(wf.path, existing ? { ...existing, content: wf.content } : { path: wf.path, kind: 'modified', content: wf.content })
      }
    }
  }
  return [...files.values()]
}

export function deriveArtifacts(items: readonly Item[], workspace: string | null): ArtifactSummary {
  const servers = new Map<string, ArtifactServer>()
  const sources = new Map<string, ArtifactSource>()
  const roles: string[] = []
  let subTotal = 0
  let subDone = 0
  let lastArgUrl: string | null = null
  let lastOutputUrl: string | null = null

  for (const item of items) {
    switch (item.type) {
      case 'tool': {
        const card = item.card
        if (card.name === 'execute_command' && card.output) {
          for (const raw of card.output.match(LOOPBACK_RE) ?? []) {
            const url = normalizeLoopback(raw)
            if (!servers.has(url)) servers.set(url, { url })
          }
        }
        if (card.name.startsWith('browser') || card.name.startsWith('mcp__chrome-devtools__')) {
          const argUrl = browserArgUrl(card)
          if (argUrl) {
            lastArgUrl = argUrl                                  // 导航目标优先
          } else if (!isNonNavBrowserTool(card.name) && card.output) {
            const m = card.output.match(HTTP_RE)                 // 无 url 参数才退回抽 output(排除 status/connect)
            if (m) lastOutputUrl = m[0]
          }
        }
        break
      }
      case 'team': {
        subTotal += item.steps.length
        subDone += item.steps.filter(s => s.status === 'done').length
        for (const a of item.agents) if (!roles.includes(a.role)) roles.push(a.role)
        break
      }
      case 'user': {
        for (const att of item.attachments ?? []) {
          if (!sources.has(att.path)) sources.set(att.path, { path: att.path, name: att.name, kind: att.kind })
        }
        break
      }
      default:
        break
    }
  }

  const browserUrl = lastArgUrl ?? lastOutputUrl
  const subagents = (subTotal > 0 || roles.length > 0) ? { total: subTotal, done: subDone, roles } : null
  const fileList = deriveFiles(items)
  const serverList = [...servers.values()]
  const sourceList = [...sources.values()]
  const isEmpty =
    fileList.length === 0 && serverList.length === 0 && subagents === null &&
    browserUrl === null && sourceList.length === 0

  return { files: fileList, servers: serverList, subagents, browserUrl, sources: sourceList, workspace, isEmpty }
}
