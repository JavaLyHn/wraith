/** Policy status, audit, sandbox state + browser command results. */

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

/**
 * 后端报出的沙箱种类(initialize.capabilities.sandbox 与 sandbox.get 的 kind 共用)。
 *
 * `unknown` 只在前端出现:后端没回或回了个不认识的值。它与 `none` 必须分开 ——
 * 前者是灰盾「状态未知」,后者是红盾「本该有却没起来」,把未知说成异常是误报。
 */
export type SandboxKindWire = 'macos-seatbelt' | 'windows-appcontainer' | 'none' | 'unknown'

/** 命令沙箱状态(AppServer sandbox.get/set 回包)。 */
export interface SandboxState {
  /** 兼容字段,等价于 kind !== 'none'。新代码读 kind。 */
  available: boolean
  /**
   * 具体是哪一种沙箱。后端此前只回布尔,于是「Windows 没这东西」与
   * 「mac 上 sandbox-exec 不见了」拿到同一个 none,前端只能靠 platform 反推。
   * 加上 AppContainer 之后三态并存,必须由后端说清楚。
   */
  kind?: 'macos-seatbelt' | 'windows-appcontainer' | 'none'
  networkAllowed: boolean
  /** 无沙箱时的可读原因。此前只进后端 log.warn,桌面用户看不到。 */
  degradedReason?: string | null
}

/** 浏览器命令结果(AppServer browser.* 回包,文本直通)。 */
export interface BrowserCmdResult {
  text: string
}
