/** Automation schedules, approval workflow, tasks, runs, delivery. */

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

export interface ChoiceOption {
  label: string
  description: string | null
}
export interface PendingChoice {
  choiceId: string
  title: string
  options: ChoiceOption[]
  allowCancel: boolean
  hint: string | null
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

/** QQ 待发队列条目(automations.qqPending 线上形状;遗留旧文件项可能无 id)。 */
export interface QqPendingItem {
  id?: string
  taskName: string
  answerPreview: string
  ts: number
  kind: 'result' | 'approval'
  approvalId?: string
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
