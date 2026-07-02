/**
 * Shared protocol types for the Wraith desktop shell ↔ Java app-server IPC.
 * Framing: JSON-RPC 2.0, one JSON object per line (JSONL) on child-process stdin/stdout.
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire shapes
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: object
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: number
  result: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: number
  error: JsonRpcErrorObject
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcInbound =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification

// ---------------------------------------------------------------------------
// Backend event catalog (notifications from app-server → renderer)
// ---------------------------------------------------------------------------

/** Streaming text delta from an assistant turn. */
export interface MessageDeltaEvent {
  type: 'message.delta'
  text: string
}

/** The current assistant turn is complete. */
export interface MessageDoneEvent {
  type: 'message.done'
}

/** An error surfaced by the backend. */
export interface BackendErrorEvent {
  type: 'error'
  code: string
  message: string
}

/** Agent state snapshot (thinking / executing / idle). */
export interface AgentStateEvent {
  type: 'agent.state'
  state: 'idle' | 'thinking' | 'executing'
}

/** A tool call the agent is about to perform. */
export interface ToolCallEvent {
  type: 'tool.call'
  name: string
  input: unknown
}

/** Result of a completed tool call. */
export interface ToolResultEvent {
  type: 'tool.result'
  name: string
  output: unknown
}

/** Union of all backend push events (legacy event catalog). */
export type LegacyBackendEvent =
  | MessageDeltaEvent
  | MessageDoneEvent
  | BackendErrorEvent
  | AgentStateEvent
  | ToolCallEvent
  | ToolResultEvent

// ---------------------------------------------------------------------------
// Reducer-layer BackendEvent (JSON-RPC 2.0 notification + connection events)
// Used by transcriptReducer and JsonRpcClient event bus.
// ---------------------------------------------------------------------------

/** A JSON-RPC 2.0 server-push notification dispatched from app-server. */
export interface BackendNotificationEvent {
  kind: 'notification'
  method: string
  params: unknown
}

/** Connection-state change (child process connected / disconnected). */
export interface BackendConnectionEvent {
  kind: 'connection'
  state: 'connected' | 'disconnected'
}

/** Union of all events the transcriptReducer handles. */
export type BackendEvent = BackendNotificationEvent | BackendConnectionEvent

// ---------------------------------------------------------------------------
// Phase B: session persistence / resume wire types
// ---------------------------------------------------------------------------

/** One session's metadata (mirrors Java SessionMeta record). */
export interface SessionMeta {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  title: string
  turns: number
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
}

// ---------------------------------------------------------------------------
// Phase E-1: MCP Server management
// ---------------------------------------------------------------------------

export interface McpToolView {
  name: string
  description: string
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
