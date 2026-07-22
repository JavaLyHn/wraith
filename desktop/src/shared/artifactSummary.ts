/**
 * artifactSummary — 纯 TS,从 transcript items 派生「本会话产物摘要」。
 * 无 React/Electron 依赖,可单测。四段:输出(文件+服务)/子智能体/浏览器/来源。
 */
import type { Item, ToolCard } from './transcriptReducer'

export interface ArtifactFile { path: string; kind: 'created' | 'modified' }
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

// 回环地址(本地 dev server / 预览):可选 http(s):// 前缀 + localhost|127.0.0.1 + 必须带端口。
const LOOPBACK_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s'"`]*)?/gi
// 任意 http(s) URL(浏览器活动从 output 兜底抽)。
const HTTP_RE = /https?:\/\/[^\s'"`]+/i

/** 归一化回环 URL:去尾部标点与尾斜杠、补 http:// 前缀,便于去重。 */
function normalizeLoopback(raw: string): string {
  let u = raw.trim().replace(/[),.;'"]+$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  return u
}

/** 浏览器工具的目标 URL:先 argsJson.url,再从 output 抽首个 http(s)。 */
function browserToolUrl(card: ToolCard): string | null {
  try {
    const args = JSON.parse(card.argsJson) as Record<string, unknown>
    if (typeof args['url'] === 'string' && args['url'].trim()) return args['url'].trim()
  } catch { /* 非 JSON,忽略 */ }
  const m = card.output ? card.output.match(HTTP_RE) : null
  return m ? m[0] : null
}

export function deriveArtifacts(items: readonly Item[], workspace: string | null): ArtifactSummary {
  const files = new Map<string, ArtifactFile>()
  const servers = new Map<string, ArtifactServer>()
  const sources = new Map<string, ArtifactSource>()
  const roles: string[] = []
  let subTotal = 0
  let subDone = 0
  let browserUrl: string | null = null

  for (const item of items) {
    switch (item.type) {
      case 'diff': {
        if (item.filePath && !files.has(item.filePath)) {
          files.set(item.filePath, { path: item.filePath, kind: item.before === '' ? 'created' : 'modified' })
        }
        break
      }
      case 'tool': {
        const card = item.card
        if (card.name === 'execute_command' && card.output) {
          for (const raw of card.output.match(LOOPBACK_RE) ?? []) {
            const url = normalizeLoopback(raw)
            if (!servers.has(url)) servers.set(url, { url })
          }
        }
        if (card.name.startsWith('browser') || card.name.startsWith('mcp__chrome-devtools__')) {
          const u = browserToolUrl(card)
          if (u) browserUrl = u
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

  const subagents = (subTotal > 0 || roles.length > 0) ? { total: subTotal, done: subDone, roles } : null
  const fileList = [...files.values()]
  const serverList = [...servers.values()]
  const sourceList = [...sources.values()]
  const isEmpty =
    fileList.length === 0 && serverList.length === 0 && subagents === null &&
    browserUrl === null && sourceList.length === 0

  return { files: fileList, servers: serverList, subagents, browserUrl, sources: sourceList, workspace, isEmpty }
}
