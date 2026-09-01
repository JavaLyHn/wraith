/** Session, project, MCP, provider views + model list. */

export interface SessionMeta {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  title: string
  turns: number           // count of user turns
  starred?: boolean        // 用户标记的重点会话
  name?: string            // 用户自定义名;显示优先于 title
  archivedAt?: string | null  // 归档时间(ISO-8601);null/缺省=未归档。归档的不进侧栏列表
}

/** A tool call inside a resumed assistant message (mirrors SessionMessageCodec). */
export interface ResumedToolCall {
  id: string
  name: string
  arguments: string
}

/** A stored message returned by session.resume (SessionMessageCodec.toJson shape). */
export interface ResumedMessage {
  role: string
  content: string | null
  reasoningContent?: string
  toolCallId?: string
  toolCalls?: ResumedToolCall[]
}

// ---------------------------------------------------------------------------
// Phase C: status 事件负载(Java StatusInfo 的前端子集)
// ---------------------------------------------------------------------------

export interface StatusData {
  model: string
  totalTokens: number
  contextWindow: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  estimatedCost: string | null
  elapsedMillis: number
  phase: string
}

// ---------------------------------------------------------------------------
// Phase D: project workspace management
// ---------------------------------------------------------------------------

/** 项目条目视图(main → renderer):settings.ProjectEntry + 目录存在性。 */
export interface ProjectView {
  path: string
  name?: string
  lastUsedAt: number
  exists: boolean
  starred?: boolean
  order?: number
}

/** 一个项目的会话概况(session.projectSummary 回传)。 */
export interface ProjectSummary {
  path: string
  sessionCount: number
  /** 最新未归档会话的 updatedAt;无会话时 null */
  lastSessionAt: string | null
}

// ---------------------------------------------------------------------------
// Phase E-1: MCP Server management
// ---------------------------------------------------------------------------

export interface McpToolView {
  name: string
  description: string
  /** 工具入参 JSON schema(mcp.list 回传;后端 sanitize 过;可缺省) */
  parameters?: unknown
}

export interface McpServerView {
  name: string
  state: 'starting' | 'ready' | 'disabled' | 'error'
  scope: 'user' | 'project' | 'builtin'
  enabled: boolean
  shadowed: boolean
  transport: 'stdio' | 'http' | string
  tools: McpToolView[]
  envKeys: string[]
  /** stdio 型回传(非密钥),编辑表单回填用;http 型缺省 */
  command?: string
  args?: string[]
  error?: string
}

export interface McpListResult {
  servers: McpServerView[]
  configError?: string
}

export interface McpResourceView {
  server: string
  uri: string
  name: string
  description?: string
}

export interface McpUpsertPayload {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

/** mcp.test 回包:临时进程探测结果(绝不含 env 值)。 */
export interface McpTestResult {
  ok: boolean
  toolCount?: number
  latencyMs?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Task 5: model/provider management
// ---------------------------------------------------------------------------

export interface ProviderView {
  name: string
  model: string
  hasKey: boolean
  protocol?: string
  baseUrl?: string
  label?: string
}

export interface ModelListResult {
  current: { provider: string; model: string }
  default: string
  providers: ProviderView[]
}
