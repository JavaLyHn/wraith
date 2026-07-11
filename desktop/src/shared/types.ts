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
  turns: number           // count of user turns
  starred?: boolean        // 用户标记的重点会话
  name?: string            // 用户自定义名;显示优先于 title
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

export interface SkillView {
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  source: 'builtin' | 'user' | 'project'
  enabled: boolean
}

export interface SkillListResult {
  skills: SkillView[]
}

/** 长期记忆条目视图(AppServer memory.* 回包)。 */
export interface MemoryEntryView {
  id: string
  content: string
  scope: string // 'project' | 'global'
  type: string  // MemoryEntry.MemoryType 枚举名(FACT/CONVERSATION/…)
  timestampMs: number
  tokenCount: number
}

export interface MemoryListResult {
  project: string
  entries: MemoryEntryView[]
  wraithMdExists?: boolean
  wraithMdPath?: string
}

/** WRAITH.md 生成结果(AppServer memory.initProject 回包)。 */
export interface ProjectMemoryInitResult {
  written: boolean
  path: string
  message: string
}

/** side-git 快照条目视图(AppServer snapshot.* 回包)。 */
export interface SnapshotEntryView {
  commitId: string
  shortId: string
  phase: string // PRE_TURN | POST_TURN | PRE_RESTORE
  turnId: string
  summary: string
  createdAtMs: number
  preTurnOffset: number // >0 表示可恢复的 pre-turn 快照(其 restore offset);0 = 非 pre-turn
}

export interface SnapshotListResult {
  enabled: boolean
  snapshots: SnapshotEntryView[]
}

/** 后台任务视图(AppServer task.* 回包)。 */
export interface DurableTaskView {
  id: string
  status: string // enqueued | running | completed | failed | canceled
  prompt: string
  createdAtMs: number
  durationMs: number
  result?: string
  error?: string | null
  found?: boolean
}
export interface TaskListResult {
  enabled: boolean
  tasks: DurableTaskView[]
  error?: string
}

export interface SnapshotRestoreResult {
  ok: boolean
  message: string
  commitId: string
  restoredCount: number
  removedCount: number
}

/** 安全策略状态视图(AppServer policy.status 回包)。 */
export interface PolicyStatusView {
  projectRoot: string
  auditDir: string
  dangerousTools: string[]
}

/** 单条危险工具审计记录(AppServer audit.list 回包)。 */
export interface AuditEntryView {
  timestamp: string // ISO-8601
  tool: string
  args: string
  outcome: string // allow | deny | error
  reason?: string | null
  approver?: string | null // hitl | policy | none | mention
  durationMs: number
  browserMode?: string
  sensitive?: boolean
  targetUrl?: string
}

export interface AuditListResult {
  entries: AuditEntryView[]
}

/** 命令沙箱状态(AppServer sandbox.get/set 回包)。 */
export interface SandboxState {
  available: boolean
  networkAllowed: boolean
}

/** 浏览器命令结果(AppServer browser.* 回包,文本直通)。 */
export interface BrowserCmdResult {
  text: string
}

/** Embedding 后端配置视图(config.getEmbedding 回包;key 不回,只回 hasKey)。 */
export interface EmbeddingConfigView {
  provider: string
  model: string
  baseUrl: string
  hasKey: boolean
}

export interface RagStatus {
  indexed: boolean
  chunkCount: number
  relationCount: number
  error?: string
}

export interface RagIndexResult {
  chunkCount?: number
  relationCount?: number
  message?: string
  error?: string
}

export interface RagSearchItem {
  filePath: string
  chunkType: string
  name: string
  content: string
  similarity: number
}

export interface RagSearchResult {
  results: RagSearchItem[]
  error?: string
}

export interface RagRelation {
  fromName: string
  toName: string
  relationType: string
  fromFile: string
  toFile: string
}

export interface RagGraphResult {
  relations: RagRelation[]
  error?: string
}

export interface SkillReference {
  path: string
  content: string
}
export interface SkillDetail extends SkillView {
  body: string
  references?: SkillReference[]
}

export interface SkillUpsertPayload {
  scope: 'user' | 'project'
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  body: string
  references?: SkillReference[]
}

// ---------------------------------------------------------------------------
// Phase E-2: 定时自动化
// ---------------------------------------------------------------------------

export type AutomationSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }                     // 'HH:mm' 本地时区
  | { kind: 'weekly'; weekday: number; time: string }   // 0-6,周日=0
  | { kind: 'cron'; expr: string }                      // cron 表达式(守护进程侧执行)

// ---------------------------------------------------------------------------
// Phase F: cron delivery — approval / delivery target 类型(镜像 Java 线格式)
// ---------------------------------------------------------------------------

/** 工具调用审批模式(对应 Java ApprovalMode enum). */
export type ApprovalMode = 'deny' | 'auto-approve' | 'ask'

/** 工具调用审批策略(对应 Java ApprovalPolicy record). */
export interface ApprovalPolicy {
  default: ApprovalMode
  tools?: Record<string, ApprovalMode>
  askTimeoutMinutes?: number
}

/** 消息投递目标(对应 Java DeliveryTarget sealed interface). */
export type DeliveryTarget =
  | { platform: 'qq'; chatId?: string }
  | { platform: 'desktop' }
  | { platform: string; chatId?: string }

export interface AutomationTask {
  id: string
  name: string
  prompt: string
  projectPath: string
  schedule: AutomationSchedule
  enabled: boolean
  createdAt: number
  /** enabled 置 true 的时刻(interval 锚点;创建即启用时=createdAt) */
  enabledAt: number
  lastFiredAt: number | null
  /** Task 18 引入:守护进程侧的工作目录(与 projectPath 并存,过渡期两者均存) */
  workspace?: string
  /** 运行结果投递目标列表(Task 18 接线) */
  deliverTo?: DeliveryTarget[]
  /** 工具调用审批策略(Task 18 接线) */
  approval?: ApprovalPolicy
}

export type AutomationRunStatus = 'running' | 'waiting_approval' | 'success' | 'failed' | 'interrupted'

export interface AutomationRun {
  runId: string
  taskId: string
  startedAt: number
  endedAt?: number
  status: AutomationRunStatus
  sessionId?: string
  summary?: string
  miss?: boolean
  /** Set by the Java DesktopDeliveryAdapter; desktop polls and pops an OS notification when true. */
  notifyDesktop?: boolean
  /** Approval request id (format: taskId#counter); set when status=waiting_approval. */
  approvalId?: string
  /** Name of the tool awaiting approval; set when status=waiting_approval. */
  approvalTool?: string
}

export type AutomationEvent =
  | { kind: 'runs-changed' }
  | { kind: 'badge'; show: boolean }
  | { kind: 'approval'; runId: string; payload: Record<string, unknown> }
  | { kind: 'open-panel' }

// ---------------------------------------------------------------------------
// Plan mode: 运行模式 + 计划事件负载(Java PlanMode / Plan* 通知的前端镜像)
// ---------------------------------------------------------------------------

/** 会话运行模式:'react' = 传统反应模式,'plan' = 计划审批模式,'team' = 多智能体模式。 */
export type RunMode = 'react' | 'plan' | 'team'

/** 计划步骤视图(mirrors Java PlanStep). */
export interface PlanStepView { id: string; description: string; deps: string[] }

/** plan.created 通知负载。 */
export interface PlanCreatedEvent { planId: string; goal: string; steps: PlanStepView[] }

/** plan.step.started 通知负载。 */
export interface PlanStepStartedEvent { planId: string; stepId: string }

/** plan.step.completed 通知负载。 */
export interface PlanStepCompletedEvent { planId: string; stepId: string; ok: boolean; result?: string }

/** plan.review.requested 通知负载。 */
export interface PlanReviewRequestedEvent { reviewId: string; planId: string; goal: string; steps: PlanStepView[] }

/** plan.step.output 通知负载（步骤流式正文片段，嵌套在清单步骤行下方）。 */
export interface PlanStepOutputEvent { planId: string; stepId: string; text: string }

/** plan.output 通知负载（规划器"生成计划"阶段的流式正文，plan.created 到达前的空窗期）。 */
export interface PlanOutputEvent { planId: string; text: string }

// ---------------------------------------------------------------------------
// Team mode: 多智能体运行模式 + 团队事件负载(Java TeamMode / Team* 通知的前端镜像)
// ---------------------------------------------------------------------------

/** team.started 通知负载。 */
export interface TeamStartedEvent { teamId: string; goal: string; agents: { id: string; role: string }[] }

/** 团队步骤视图(mirrors Java TeamStep). */
export interface TeamStepView { id: string; description: string; type: string; dependencies: string[] }

/** team.plan 通知负载。 */
export interface TeamPlanEvent { teamId: string; steps: TeamStepView[] }

/** team.batch 通知负载。 */
export interface TeamBatchEvent { teamId: string; batchIndex: number; stepIds: string[] }

/** team.step.started 通知负载。 */
export interface TeamStepStartedEvent { teamId: string; stepId: string; agent: string }

/** team.step.completed 通知负载。 */
export interface TeamStepCompletedEvent { teamId: string; stepId: string; status: string; result: string; approved: boolean; retries: number }

/** team.finished 通知负载。 */
export interface TeamFinishedEvent { teamId: string; status: string }

/** team.plan.output 通知负载（规划器流式正文片段）。 */
export interface TeamPlanOutputEvent { teamId: string; text: string }

/** team.step.output 通知负载（步骤流式正文片段）。 */
export interface TeamStepOutputEvent { teamId: string; stepId: string; text: string }

/** team.review.output 通知负载（审评流式正文片段）。 */
export interface TeamReviewOutputEvent { teamId: string; stepId: string; text: string }

export interface AppInfo { version: string; repoUrl: string; dataDir: string }
export interface UpdateResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  isPrerelease: boolean
  error?: string
}

/** 内置工具定义(tools.list 回传;= 模型看到的定义)。 */
export interface BuiltinToolView { name: string; description: string; parameters?: unknown }
