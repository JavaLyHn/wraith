/**
 * transcriptReducer — pure TS, no React/Electron imports.
 *
 * Folds a stream of BackendEvent values into a TranscriptState view-model
 * that the React UI renders. All updates are immutable (new objects/arrays).
 *
 * Message-sealing strategy:
 *   We keep an internal `_messageOpen` flag on TranscriptState. When
 *   `message.end` arrives we set it to false. The next `message.delta` then
 *   pushes a new item instead of appending to the last one. This avoids
 *   scanning the items array and is O(1).
 */

import type { BackendEvent, ChoiceOption, PendingChoice, StatusData, PlanStepView, SandboxKindWire, RunMode } from './types'
import { shouldPopChatApproval } from './approvalScope'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolCard {
  callId: string
  name: string
  argsJson: string
  output: string
  ok?: boolean
  exitCode?: number
  done: boolean
}

/** 计划步骤的渲染状态。 */
export interface PlanStepItem {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
  /** 步骤流式正文（plan.step.output delta 累积；默认折叠展示在步骤行下方）。 */
  output?: string
}

/** 计划清单 item（plan.created / step.* 事件维护）。 */
export interface PlanItem {
  type: 'plan'
  planId: string
  goal: string
  steps: PlanStepItem[]
  /** 规划器"生成计划"阶段的流式正文（plan.output delta 累积；steps 到达前的实时进度）。 */
  plannerOutput?: string
}

/** 计划复审 item（plan.review.requested 事件追加，响应后前端标记 resolved）。 */
export interface PlanReviewItem {
  type: 'planReview'
  reviewId: string
  planId: string
  goal: string
  steps: PlanStepView[]
  resolved: boolean
}

/** 团队步骤的渲染状态。 */
export interface TeamStep {
  id: string
  description: string
  type: string
  agent?: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  result?: string
  /** 步骤流式正文（team.step.output delta 累积；与完成时的 result 字段独立）。 */
  output?: string
  /** 复审器流式正文（team.review.output delta 累积）。 */
  reviewOutput?: string
  /**
   * 复审器**当前**是否在跑（team.review.started / completed）。
   *
   * 此前不存在这个字段:reviewer 唯一的信号是流式正文增量,于是「reviewer 正在审查」
   * 这个阶段在 UI 里无从表达 —— 审查块要等第一个 token 才出现,思考型模型出第一个
   * token 前沉默那几十秒里整张卡片静止,用户以为死机了。
   */
  reviewStatus?: 'running' | 'done'
  approved?: boolean
  retries?: number
}

/** 多智能体团队 item（team.* 事件维护）。 */
export interface TeamItem {
  type: 'team'
  teamId: string
  goal: string
  agents: { id: string; role: string }[]
  steps: TeamStep[]
  parallelStepIds: string[]
  status?: 'completed' | 'partial' | 'failed'
  /** 规划器流式输出（team.plan.output delta 累积）。 */
  plannerOutput?: string
}

/** 用户消息里附带的附件引用(仅展示用:路径/名字/类型)。 */
export interface AttachmentRef { path: string; name: string; kind: string }

/** 单条压缩记录('context.compaction' 事件平铺 payload 的前端形态)。ts 为前端收到时刻写入——reducer 允许的例外(见文件头)。 */
export interface CompactionEntry {
  ts: number
  tier: number
  beforeTokens: number
  afterTokens: number
  snipped: number
  pruned: number
  summarized: boolean
  fallback?: 'cooldown' | 'emergency'
  manual?: boolean
  savedTokens: number
  items?: { index: number; tool?: string; releasedEstTokens: number; logPath?: string }[]
}

/**
 * 上下文治理可观测切片(Phase C,spec §1)。三来源合并:
 *  - `context.watermark` 事件 → 覆盖 watermark(真实锚点口径,最高优先,estimated 恒 false)。
 *  - `context.compaction` 事件 → push 进 compactions(上限 200,超出丢最老)。
 *  - `context.state.get` 快照(App 合成为 `context.snapshot`)→ 初始化 watermark(带 estimated 标注)/liveSummary/totalsFromSnapshot。
 */
export interface ContextObservability {
  watermark: { usedTokens: number; window: number; ratio: number; tier: number; estimated: boolean } | null
  compactions: CompactionEntry[]
  liveSummary: string | null
  totalsFromSnapshot: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    estimatedCost?: string
    estimated: boolean
  } | null
}

/** `context` 切片的空白态——initialState/resetSession/`context.reset` 三处共用,防漂移。 */
const CONTEXT_INITIAL: ContextObservability = { watermark: null, compactions: [], liveSummary: null, totalsFromSnapshot: null }

export type Item =
  /**
   * 用户气泡。`mode` = 本轮**实际生效**的执行模式，由后端 `turn.started` 回声（归一化后）。
   *
   * 此前模式是一条单向的线（前端 React state → turn.submit 参数 → 后端分支），不回声，
   * 于是用户「不能知道 agent 有没有感知到模式的切换」。老后端不回声时保持 undefined，
   * 不臆造一个默认值 —— 显示一个没被证实的模式与不显示同样糟。
   */
  | { type: 'user'; text: string; attachments?: AttachmentRef[]; mode?: RunMode }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'thinking'; label: string; text: string; done: boolean }
  | { type: 'tool'; card: ToolCard }
  | { type: 'diff'; filePath: string; before: string; after: string }
  | { type: 'action'; panel: string }
  | { type: 'im-bind'; platform: string }
  /** UI 侧代提的系统事件(如「绑定成功」);后端历史里是带前缀的 user 消息,见 shared/systemEvent。 */
  | { type: 'system-event'; text: string }
  /** 后台任务跑完的静默药丸;点它去后台任务面板看结果。纯 UI 态,不进后端历史。 */
  | { type: 'task-done'; taskId: string; text: string; ok: boolean }
  | PlanItem
  | PlanReviewItem
  | TeamItem

export interface TranscriptState {
  items: Item[]
  pendingApproval: {
    approvalId: string
    toolName: string
    argsJson: string
    dangerLevel: string
    riskDescription: string
    suggestion: string
    beforeContent: string | null
  } | null
  pendingChoice: PendingChoice | null
  turn: 'idle' | 'running'
  connection: 'connected' | 'disconnected'
  model: string
  /** 前门：首条消息发出后翻 true，控制欢迎态/对话态。 */
  hasStarted: boolean
  /** 审批模式：ask=逐个弹窗，auto=替我审批（自动放行）。 */
  approvalMode: 'ask' | 'auto'
  /** 当前工作目录（驱动 composer 的项目按钮显示）。 */
  workspace: string
  /** 当前活跃会话 id(turn.completed / resume 更新)。 */
  sessionId: string
  /** 沙箱状态(initialize.capabilities.sandbox 播种,之后由 sandbox.get/set 持续刷新)。 */
  sandbox: SandboxKindWire
  /**
   * 沙箱是否放行了网络出口。
   *
   * <p>跟 {@link TranscriptState.sandbox} 分开存是因为它们的来源与变化频率都不同:
   * kind 由环境决定(基本不变),联网位由用户在安全面板上现拨。顶栏那枚盾要同时看这两样 ——
   * 只看 kind 的话,用户拨了唯一能拨的开关却什么也没发生。
   */
  sandboxNet: boolean
  /** token 状态(status 事件,resetSession 清空)。 */
  status: StatusData | null
  /** 上下文治理可观测(Phase C;watermark/compaction 事件 + snapshot 合成事件三源合并,resetSession 显式清零)。 */
  context: ContextObservability
  /** Internal flag: true when the last message item is still open for appending. */
  _messageOpen: boolean
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: TranscriptState = {
  items: [],
  pendingApproval: null,
  pendingChoice: null,
  turn: 'idle',
  connection: 'disconnected',
  model: '',
  hasStarted: false,
  approvalMode: 'ask',
  workspace: '',
  sessionId: '',
  sandbox: 'unknown',
  sandboxNet: false,
  status: null,
  context: CONTEXT_INITIAL,
  _messageOpen: false,
}

// ---------------------------------------------------------------------------
// Helper — safe extraction of string field from tool argsJson
// ---------------------------------------------------------------------------

/**
 * 把本轮实际生效的模式标到**最后一条**用户气泡上。
 *
 * 从尾部往前找第一条 user:气泡在提交瞬间就已乐观追加,而 turn.started 稍后到达,
 * 期间可能已插入别的 item(message.delta 等),所以不能只看数组最后一项。
 * 没有 user 气泡(自动化触发的轮次)时原样返回。
 */
function tagLastUserMode(items: Item[], mode: RunMode): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'user') {
      if (it.mode === mode) return items          // 幂等:重复事件不制造新数组
      const next = items.slice()
      next[i] = { ...it, mode }
      return next
    }
  }
  return items
}

/** 从工具 argsJson 安全取一个字符串字段;非法 JSON / 缺字段 → 空串,绝不抛。 */
function toolArgString(argsJson: string, key: string): string {
  try {
    const o = JSON.parse(argsJson) as Record<string, unknown>
    return typeof o?.[key] === 'string' ? (o[key] as string) : ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Helper — immutably update a ToolCard inside items
// ---------------------------------------------------------------------------

function updateToolCard(
  items: Item[],
  callId: string,
  updater: (card: ToolCard) => ToolCard,
): Item[] {
  return items.map(item => {
    if (item.type === 'tool' && item.card.callId === callId) {
      return { ...item, card: updater(item.card) }
    }
    return item
  })
}

// ---------------------------------------------------------------------------
// Helper — 不可变更新 plan item 内的某个步骤
// ---------------------------------------------------------------------------

function updatePlanStep(
  state: TranscriptState,
  planId: string,
  stepId: string,
  fn: (step: PlanStepItem) => PlanStepItem,
): TranscriptState {
  return {
    ...state,
    items: state.items.map(it => {
      if (it.type === 'plan' && it.planId === planId) {
        return { ...it, steps: it.steps.map(st => st.id === stepId ? fn(st) : st) }
      }
      return it
    }),
  }
}

// ---------------------------------------------------------------------------
// Helper — 不可变更新 team item 内的某个步骤
// ---------------------------------------------------------------------------

function updateTeamStep(
  state: TranscriptState,
  teamId: string,
  stepId: string,
  fn: (step: TeamStep) => TeamStep,
): TranscriptState {
  return {
    ...state,
    items: state.items.map(it => {
      if (it.type === 'team' && it.teamId === teamId) {
        return { ...it, steps: it.steps.map(st => st.id === stepId ? fn(st) : st) }
      }
      return it
    }),
  }
}

// ---------------------------------------------------------------------------
// Core reducer
// ---------------------------------------------------------------------------

export function reduce(state: TranscriptState, evt: BackendEvent): TranscriptState {
  // ── connection event ──────────────────────────────────────────────────────
  if (evt.kind === 'connection') {
    return {
      ...state,
      connection: evt.state,
      turn: evt.state === 'disconnected' ? 'idle' : state.turn,
    }
  }

  // ── notification event ────────────────────────────────────────────────────
  const { method, params } = evt
  const p = (params ?? {}) as Record<string, unknown>

  switch (method) {
    // ── turn lifecycle ──────────────────────────────────────────────────────
    case 'turn.started': {
      // 后端在轮次开始即为新会话落桩并把真实 sessionId 带在 turn.started 里 →
      // 立即置 sessionId,使侧栏能高亮并即时拉到该会话(不必等 turn.completed)。
      const sid = typeof p['sessionId'] === 'string' ? p['sessionId'] : ''
      // mode 是后端回声的**归一化后**模式(= 本轮真正生效的那个),标在刚提交的那条用户
      // 气泡上,给用户一条可核对的记录:此前模式是一条单向的线,切了也无从确认后端收到没有。
      // 认不出来的值不写 —— 显示一个没被证实的模式是新的假话。
      const mode = typeof p['mode'] === 'string' ? p['mode'] : ''
      const items = (mode === 'react' || mode === 'plan' || mode === 'team')
        ? tagLastUserMode(state.items, mode)
        : state.items
      return { ...state, turn: 'running', items, ...(sid ? { sessionId: sid } : {}) }
    }

    case 'turn.completed': {
      const sid = typeof p['sessionId'] === 'string' ? p['sessionId'] : ''
      return { ...state, turn: 'idle', ...(sid ? { sessionId: sid } : {}) }
    }
    case 'turn.failed': {
      const err = sanitizeErrorText(typeof p['error'] === 'string' ? p['error'] : '')
      if (err) {
        return { ...state, turn: 'idle', _messageOpen: false, items: [...state.items, { type: 'error', text: err }] }
      }
      return { ...state, turn: 'idle' }
    }

    // ── message streaming ───────────────────────────────────────────────────
    case 'message.delta': {
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      if (state._messageOpen && state.items.length > 0) {
        // Append to the last message item
        const last = state.items[state.items.length - 1]
        if (last.type === 'message') {
          const updatedItems: Item[] = [
            ...state.items.slice(0, -1),
            { ...last, text: last.text + text },
          ]
          return { ...state, items: updatedItems }
        }
      }
      // Open a new message bubble
      return {
        ...state,
        items: [...state.items, { type: 'message', text }],
        _messageOpen: true,
      }
    }

    case 'message.end':
      return { ...state, _messageOpen: false }

    // ── thinking streaming ──────────────────────────────────────────────────
    case 'thinking.begin': {
      const label = typeof p['label'] === 'string' ? p['label'] : ''
      const newItem: Item = { type: 'thinking', label, text: '', done: false }
      return { ...state, items: [...state.items, newItem] }
    }

    case 'thinking.delta': {
      const chunk = typeof p['text'] === 'string' ? p['text'] : ''
      // Append to the last thinking item
      const items = state.items.map((item, idx) => {
        if (idx === state.items.length - 1 && item.type === 'thinking') {
          return { ...item, text: item.text + chunk }
        }
        return item
      })
      return { ...state, items }
    }

    case 'thinking.end': {
      // 空思考块(begin 后无任何 delta)直接丢弃——旧版后端对非 reasoning 模型会发空对
      const last = state.items[state.items.length - 1]
      if (last && last.type === 'thinking' && last.text === '') {
        return { ...state, items: state.items.slice(0, -1) }
      }
      const items = state.items.map((item, idx) => {
        if (idx === state.items.length - 1 && item.type === 'thinking') {
          return { ...item, done: true }
        }
        return item
      })
      return { ...state, items }
    }

    // ── tool call lifecycle ─────────────────────────────────────────────────
    case 'tool.call': {
      const callId = typeof p['callId'] === 'string' ? p['callId'] : ''
      const name = typeof p['name'] === 'string' ? p['name'] : ''
      const argsJson = typeof p['argsJson'] === 'string' ? p['argsJson'] : ''
      // UI 意图工具:特判成动作卡 item,不走 ToolCard(其 tool.result/tool.output.delta 因无匹配 callId 安全忽略)。
      if (name === 'open_panel') {
        return { ...state, items: [...state.items, { type: 'action', panel: toolArgString(argsJson, 'panel') }] }
      }
      if (name === 'im_connect') {
        return { ...state, items: [...state.items, { type: 'im-bind', platform: toolArgString(argsJson, 'platform') }] }
      }
      const card: ToolCard = { callId, name, argsJson, output: '', done: false }
      return { ...state, items: [...state.items, { type: 'tool', card }] }
    }

    case 'tool.output.delta': {
      const callId = typeof p['callId'] === 'string' ? p['callId'] : ''
      const chunk = typeof p['chunk'] === 'string' ? p['chunk'] : ''
      const items = updateToolCard(state.items, callId, card => ({
        ...card,
        output: card.output + chunk + '\n',
      }))
      return { ...state, items }
    }

    case 'tool.result': {
      const callId = typeof p['callId'] === 'string' ? p['callId'] : ''
      const ok = typeof p['ok'] === 'boolean' ? p['ok'] : undefined
      const exitCode = typeof p['exitCode'] === 'number' ? p['exitCode'] : undefined
      const items = updateToolCard(state.items, callId, card => ({
        ...card,
        ok,
        exitCode,
        done: true,
      }))
      return { ...state, items }
    }

    // ── approval ────────────────────────────────────────────────────────────
    case 'approval.requested': {
      const approvalId = typeof p['approvalId'] === 'string' ? p['approvalId'] : ''
      // 后台定时任务的审批也打进这条流,但它归自动化面板的内联批准处理,不该在主会话弹
      // 全屏阻塞模态(判据与理由见 approvalScope.ts —— 只看 id 形状,别加 sessionId)。
      if (!shouldPopChatApproval(approvalId)) {
        return state
      }
      const toolName = typeof p['toolName'] === 'string' ? p['toolName'] : ''
      const argsJson = typeof p['argsJson'] === 'string' ? p['argsJson'] : ''
      const dangerLevel = typeof p['dangerLevel'] === 'string' ? p['dangerLevel'] : ''
      const riskDescription = typeof p['riskDescription'] === 'string' ? p['riskDescription'] : ''
      const suggestion = typeof p['suggestion'] === 'string' ? p['suggestion'] : ''
      const beforeContent = typeof p['beforeContent'] === 'string' ? p['beforeContent'] : null
      return {
        ...state,
        pendingApproval: { approvalId, toolName, argsJson, dangerLevel, riskDescription, suggestion, beforeContent },
      }
    }

    // ── choice（交互式选择器,与 approval 一样是临时 modal 不进 transcript）──
    case 'choice.requested': {
      const choiceId = typeof p['choiceId'] === 'string' ? p['choiceId'] : ''
      if (!choiceId) return state
      const title = typeof p['title'] === 'string' ? p['title'] : '请选择'
      const rawOptions = Array.isArray(p['options']) ? p['options'] : []
      const options: ChoiceOption[] = rawOptions.map((o: any) => ({
        label: typeof o?.label === 'string' ? o.label : '',
        description: o?.description == null ? null : String(o.description),
      }))
      const allowCancel = p['allowCancel'] === true
      const hint = typeof p['hint'] === 'string' ? p['hint'] : null
      return {
        ...state,
        pendingChoice: { choiceId, title, options, allowCancel, hint },
      }
    }

    // ── diff (write_file 执行后的前后全文) ───────────────────────────────────
    case 'diff': {
      const filePath = typeof p['file'] === 'string' ? (p['file'] as string) : typeof p['filePath'] === 'string' ? (p['filePath'] as string) : ''
      const before = typeof p['before'] === 'string' ? p['before'] : ''
      const after = typeof p['after'] === 'string' ? p['after'] : ''
      return {
        ...state,
        items: [...state.items, { type: 'diff', filePath, before, after }],
        _messageOpen: false,
      }
    }

    // ── status (token/阶段状态,高频;节流在 App 入口) ─────────────────────────
    case 'status': {
      const s = p['status'] as Record<string, unknown> | undefined
      if (!s || typeof s !== 'object') return state
      const num = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0)
      return {
        ...state,
        status: {
          model: typeof s['model'] === 'string' ? (s['model'] as string) : '',
          totalTokens: num('totalTokens'),
          contextWindow: num('contextWindow'),
          inputTokens: num('inputTokens'),
          outputTokens: num('outputTokens'),
          cachedInputTokens: num('cachedInputTokens'),
          estimatedCost: typeof s['estimatedCost'] === 'string' ? (s['estimatedCost'] as string) : null,
          elapsedMillis: num('elapsedMillis'),
          phase: typeof s['phase'] === 'string' ? (s['phase'] as string) : '',
        },
      }
    }

    // ── context 治理可观测(Phase C;payload 平铺,见 EventStreamRenderer.contextEvent)──
    case 'context.watermark': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      // watermark 事件均为真实读数(react 主对话锚点 / Plan-Team 峰值真实用量)→ estimated 恒 false。
      return {
        ...state,
        context: {
          ...state.context,
          watermark: { usedTokens: num('usedTokens'), window: num('window'), ratio: num('ratio'), tier: num('tier'), estimated: false },
        },
      }
    }
    case 'context.compaction': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      const entry = {
        ts: Date.now(),
        tier: num('tier'), beforeTokens: num('beforeTokens'), afterTokens: num('afterTokens'),
        snipped: num('snipped'), pruned: num('pruned'),
        summarized: p['summarized'] === true,
        ...(typeof p['fallback'] === 'string' ? { fallback: p['fallback'] as 'cooldown' | 'emergency' } : {}),
        ...(p['manual'] === true ? { manual: true } : {}),
        savedTokens: num('savedTokens'),
        ...(Array.isArray(p['items']) ? { items: p['items'] as never } : {}),
      }
      const compactions = [...state.context.compactions, entry].slice(-200)
      return { ...state, context: { ...state.context, compactions } }
    }
    case 'context.snapshot': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      // Agent.contextStateCore 快照不一定带 usedTokens/ratio/tier(仅 metrics JSONL 尾行经 aggregator
      // 补全时才有)——缺键时 num() 默认 0 会捏造 watermark={ratio:0,tier:0}("0% 宽裕"假象),
      // 故仅当快照确实带水位数据时才覆盖,缺键时保留原 watermark(初始 null 时面板自动落回估算)。
      const hasWatermark = typeof p['usedTokens'] === 'number'
      // 压缩历史回灌(aggregator 从 metrics JSONL 重建):重开应用/切会话后恢复历史条目。
      // 快照是该会话的完整持久记录,present 即为权威,直接覆盖(缺席则不动 live 累积的 compactions)。
      const snapComps = Array.isArray(p['compactions'])
        ? (p['compactions'] as Array<Record<string, unknown>>).map(c => {
            const cn = (k: string): number => (typeof c[k] === 'number' ? (c[k] as number) : 0)
            return {
              ts: cn('ts') || Date.now(),
              tier: cn('tier'), beforeTokens: cn('beforeTokens'), afterTokens: cn('afterTokens'),
              snipped: cn('snipped'), pruned: cn('pruned'),
              summarized: c['summarized'] === true,
              ...(c['manual'] === true ? { manual: true } : {}),
              savedTokens: cn('savedTokens'),
            } as CompactionEntry
          })
        : null
      return {
        ...state,
        context: {
          ...state.context,
          ...(hasWatermark
            ? {
                watermark: {
                  usedTokens: num('usedTokens'),
                  window: num('contextWindow') || num('window'),
                  ratio: num('ratio'), tier: num('tier'),
                  estimated: p['estimated'] !== false,
                },
              }
            : {}),
          ...(snapComps ? { compactions: snapComps } : {}),
          liveSummary: typeof p['liveSummary'] === 'string' ? (p['liveSummary'] as string) : null,
          totalsFromSnapshot: {
            inputTokens: num('inputTokens'), outputTokens: num('outputTokens'),
            cachedInputTokens: num('cachedInputTokens'),
            ...(typeof p['estimatedCost'] === 'string' ? { estimatedCost: p['estimatedCost'] as string } : {}),
            estimated: p['estimated'] !== false,
          },
        },
      }
    }
    // 切会话整体清切片(commitSwitchTo 合成事件):防 compactions/liveSummary 跨会话残留。
    // 切会话时序:先 context.reset 清空 → 再 context.snapshot 用新会话 JSONL 重建 compactions。
    case 'context.reset': {
      return { ...state, context: CONTEXT_INITIAL }
    }

    // ── plan mode 事件 ──────────────────────────────────────────────────────
    case 'plan.output': {
      // 规划器生成计划阶段的流式正文 delta —— 在 plan.created(计划表)到达前,
      // 提前创建/更新该 planId 的 plan item 并累积 plannerOutput,消除空窗。
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      const exists = state.items.some(it => it.type === 'plan' && it.planId === planId)
      if (exists) {
        return {
          ...state,
          items: state.items.map(it =>
            it.type === 'plan' && it.planId === planId
              ? { ...it, plannerOutput: (it.plannerOutput ?? '') + text }
              : it
          ),
        }
      }
      return { ...state, items: [...state.items, { type: 'plan', planId, goal: '', steps: [], plannerOutput: text }] }
    }

    case 'plan.created': {
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const goal = typeof p['goal'] === 'string' ? p['goal'] : ''
      const rawSteps = Array.isArray(p['steps']) ? (p['steps'] as Array<Record<string, unknown>>) : []
      const steps: PlanStepItem[] = rawSteps.map(s => ({
        id: typeof s['id'] === 'string' ? s['id'] : '',
        description: typeof s['description'] === 'string' ? s['description'] : '',
        status: 'pending' as const,
      }))
      // 幂等：同一 planId 已存在则替换(后端重新规划时会再发 plan.created)，否则追加
      const exists = state.items.some(it => it.type === 'plan' && it.planId === planId)
      if (exists) {
        return {
          ...state,
          items: state.items.map(it =>
            it.type === 'plan' && it.planId === planId
              ? { ...it, goal, steps }
              : it
          ),
        }
      }
      return { ...state, items: [...state.items, { type: 'plan', planId, goal, steps }] }
    }

    case 'plan.step.started': {
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      return updatePlanStep(state, planId, stepId, st => ({ ...st, status: 'running' }))
    }

    case 'plan.step.completed': {
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const ok = typeof p['ok'] === 'boolean' ? p['ok'] : false
      const result = typeof p['result'] === 'string' ? p['result'] : undefined
      return updatePlanStep(state, planId, stepId, st => ({
        ...st,
        status: ok ? 'done' : 'failed',
        ...(result !== undefined ? { result } : {}),
      }))
    }

    case 'plan.review.requested': {
      const reviewId = typeof p['reviewId'] === 'string' ? p['reviewId'] : ''
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const goal = typeof p['goal'] === 'string' ? p['goal'] : ''
      const steps = Array.isArray(p['steps']) ? (p['steps'] as PlanStepView[]) : []
      return {
        ...state,
        items: [...state.items, { type: 'planReview', reviewId, planId, goal, steps, resolved: false }],
      }
    }

    case 'plan.step.output': {
      // 步骤流式正文 delta — 追加到匹配步骤的 output 字段，默认折叠展示
      const planId = typeof p['planId'] === 'string' ? p['planId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      return updatePlanStep(state, planId, stepId, st => ({
        ...st,
        output: (st.output ?? '') + text,
      }))
    }

    // ── team mode 事件 ─────────────────────────────────────────────────────
    case 'team.started': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const goal = typeof p['goal'] === 'string' ? p['goal'] : ''
      const rawAgents = Array.isArray(p['agents']) ? (p['agents'] as Array<Record<string, unknown>>) : []
      const agents = rawAgents.map(a => ({
        id: typeof a['id'] === 'string' ? a['id'] : '',
        role: typeof a['role'] === 'string' ? a['role'] : '',
      }))
      const newItem: TeamItem = { type: 'team', teamId, goal, agents, steps: [], parallelStepIds: [] }
      return { ...state, items: [...state.items, newItem] }
    }

    case 'team.plan': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const rawSteps = Array.isArray(p['steps']) ? (p['steps'] as Array<Record<string, unknown>>) : []
      const steps: TeamStep[] = rawSteps.map(s => ({
        id: typeof s['id'] === 'string' ? s['id'] : '',
        description: typeof s['description'] === 'string' ? s['description'] : '',
        type: typeof s['type'] === 'string' ? s['type'] : '',
        status: 'pending' as const,
      }))
      return {
        ...state,
        items: state.items.map(it =>
          it.type === 'team' && it.teamId === teamId
            ? { ...it, steps }
            : it
        ),
      }
    }

    case 'team.batch': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const newIds = Array.isArray(p['stepIds']) ? (p['stepIds'] as string[]) : []
      return {
        ...state,
        items: state.items.map(it => {
          if (it.type === 'team' && it.teamId === teamId) {
            const merged = Array.from(new Set([...it.parallelStepIds, ...newIds]))
            return { ...it, parallelStepIds: merged }
          }
          return it
        }),
      }
    }

    case 'team.step.started': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const agent = typeof p['agent'] === 'string' ? p['agent'] : undefined
      return updateTeamStep(state, teamId, stepId, st => ({ ...st, status: 'running', ...(agent !== undefined ? { agent } : {}) }))
    }

    case 'team.step.completed': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const rawStatus = typeof p['status'] === 'string' ? p['status'] : ''
      const stepStatus: TeamStep['status'] = rawStatus === 'failed' ? 'failed' : rawStatus === 'skipped' ? 'skipped' : 'done'
      const result = typeof p['result'] === 'string' ? p['result'] : undefined
      const approved = typeof p['approved'] === 'boolean' ? p['approved'] : undefined
      const retries = typeof p['retries'] === 'number' ? p['retries'] : undefined
      return updateTeamStep(state, teamId, stepId, st => ({
        ...st,
        status: stepStatus,
        // 兜底:步骤都结算了,审查不可能还在跑。万一 team.review.completed 丢了(或被老后端
        // 省略),不补这一手 UI 会永远停在「审查中…」—— 那是一句持续的假话,比没有指示更糟。
        ...(st.reviewStatus === 'running' ? { reviewStatus: 'done' as const } : {}),
        ...(result !== undefined ? { result } : {}),
        ...(approved !== undefined ? { approved } : {}),
        ...(retries !== undefined ? { retries } : {}),
      }))
    }

    case 'team.finished': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const rawStatus = typeof p['status'] === 'string' ? p['status'] : ''
      const finishedStatus: TeamItem['status'] =
        rawStatus === 'completed' ? 'completed' : rawStatus === 'partial' ? 'partial' : rawStatus === 'failed' ? 'failed' : undefined
      return {
        ...state,
        items: state.items.map(it =>
          it.type === 'team' && it.teamId === teamId
            ? { ...it, ...(finishedStatus !== undefined ? { status: finishedStatus } : {}) }
            : it
        ),
      }
    }

    case 'team.plan.output': {
      // 规划器流式正文 delta — 追加到匹配 team 的 plannerOutput 字段
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      return {
        ...state,
        items: state.items.map(it => {
          if (it.type === 'team' && it.teamId === teamId) {
            return { ...it, plannerOutput: (it.plannerOutput ?? '') + text }
          }
          return it
        }),
      }
    }

    case 'team.step.output': {
      // 步骤流式正文 delta — 追加到匹配步骤的 output 字段
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      return updateTeamStep(state, teamId, stepId, st => ({
        ...st,
        output: (st.output ?? '') + text,
      }))
    }

    case 'team.review.started': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      return updateTeamStep(state, teamId, stepId, st => ({ ...st, reviewStatus: 'running' }))
    }

    case 'team.review.completed': {
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      return updateTeamStep(state, teamId, stepId, st => ({ ...st, reviewStatus: 'done' }))
    }

    case 'team.review.output': {
      // 复审器流式正文 delta — 按 stepId 追加到匹配步骤的 reviewOutput 字段
      const teamId = typeof p['teamId'] === 'string' ? p['teamId'] : ''
      const stepId = typeof p['stepId'] === 'string' ? p['stepId'] : ''
      const text = typeof p['text'] === 'string' ? p['text'] : ''
      return updateTeamStep(state, teamId, stepId, st => ({ ...st, reviewOutput: (st.reviewOutput ?? '') + text }))
    }

    // ── unknown → safe ignore ───────────────────────────────────────────────
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear a pending approval (call after the UI sends the approve/deny RPC). */
export function clearApproval(state: TranscriptState): TranscriptState {
  return { ...state, pendingApproval: null }
}

/** Clear a pending choice (call after the UI sends the respond RPC). */
export function clearChoice(state: TranscriptState): TranscriptState {
  return { ...state, pendingChoice: null }
}

/** Update the active model name (e.g. from initialize response). */
export function setModel(state: TranscriptState, model: string): TranscriptState {
  return { ...state, model }
}

/**
 * 前门：标记会话已开始（首条消息发出时同步调用）。
 *
 * 同步置 turn='running'：submit→turn.started 通知之间存在数百 ms~秒级空窗，
 * 若仅翻 hasStarted 而不动 turn，此空窗内 running 仍为 false，Composer 的
 * workspace-switch(disabled={running}) 可点、App 的 running 守卫放行，构成
 * submit→turn.started 竞态窗口。这里在提交瞬间即置 running，从源头关闭该窗口，
 * 让 UI 全链(禁切按钮 + 守卫)即时生效；后端 turn.started 到达时仍幂等置 running。
 */
export function markStarted(state: TranscriptState): TranscriptState {
  return { ...state, hasStarted: true, turn: 'running' }
}

/**
 * 进入对话态但不置 running —— resume/切换会话专用。
 *
 * 与 markStarted 的区别:markStarted 语义是「一个 turn 正在发起」(提交路径),会置 running;
 * 而 resume 出来的会话是历史静态回放、并无 turn 在跑,只需翻 hasStarted 展示 transcript,
 * turn 必须显式保持 idle(否则切换/选会话后按钮被误禁,项目切换器/新建会话点不动)。
 */
export function markResumed(state: TranscriptState): TranscriptState {
  return { ...state, hasStarted: true, turn: 'idle' }
}

/** 设置审批模式（UI 开关驱动）。 */
export function setApprovalMode(state: TranscriptState, mode: 'ask' | 'auto'): TranscriptState {
  return { ...state, approvalMode: mode }
}

/** 设置当前工作目录。 */
export function setWorkspace(state: TranscriptState, ws: string): TranscriptState {
  return { ...state, workspace: ws }
}

/**
 * 重选目录后重置为新会话（清空 transcript，回欢迎态，审批归 ask；保留 model/connection）。
 *
 * 兜底把 turn 归 'idle'：markStarted 现在会在提交瞬间置 running，切换会话/重选目录
 * 若不清 turn，会把上一会话的 running 态悬挂到新会话（新会话本无 turn 在跑）。
 */
export function resetSession(state: TranscriptState, ws: string): TranscriptState {
  return {
    ...state,
    items: [],
    _messageOpen: false,
    hasStarted: false,
    turn: 'idle',
    approvalMode: 'ask',
    pendingApproval: null,
    pendingChoice: null,
    workspace: ws,
    sessionId: '',
    status: null,
    // resetSession 是逐字段部分重置（非整体回 initialState），context 切片须显式清零，
    // 否则旧会话的 watermark/compactions/liveSummary 会随 `...state` 悬挂到新会话。
    context: CONTEXT_INITIAL,
  }
}

/** 用回放的 items 整体替换 transcript(切换/resume 时)。 */
export function loadHistory(state: TranscriptState, items: Item[]): TranscriptState {
  return { ...state, items, _messageOpen: false }
}

/** 设置活跃会话 id。 */
export function setSessionId(state: TranscriptState, sessionId: string): TranscriptState {
  return { ...state, sessionId }
}

/**
 * 设置沙箱状态(种类 + 联网位)。
 *
 * <p>联网位显式必传:给它一个默认值的话,`initialize` 那条播种路径会在
 * 后端其实开着 `-Dwraith.sandbox.network=on` 时悄悄写成 false ——
 * 顶栏于是理直气壮地报「已断网」,而命令正在联网跑。宁可让调用点去问一次。
 */
export function setSandbox(
  state: TranscriptState, sandbox: SandboxKindWire, networkAllowed: boolean,
): TranscriptState {
  return { ...state, sandbox, sandboxNet: networkAllowed }
}

/**
 * 将指定 reviewId 的 planReview item 标记为已处理(resolved:true)。
 * B3 PlanReviewCard 在用户提交响应后调用。
 */
export function markPlanReviewResolved(state: TranscriptState, reviewId: string): TranscriptState {
  return {
    ...state,
    items: state.items.map(it =>
      it.type === 'planReview' && it.reviewId === reviewId
        ? { ...it, resolved: true }
        : it
    ),
  }
}

// ---------------------------------------------------------------------------
// 兼容别名（测试与外部模块使用 transcriptReducer / initialTranscriptState）
// ---------------------------------------------------------------------------

/**
 * 公开别名。接受标准 BackendEvent（JSON-RPC 通知形式）或
 * 测试用的"扁平事件"形式 `{ type: 'plan.created', planId, ... }`。
 * 扁平形式会被规范化为 `{ kind: 'notification', method, params }` 后转给 reduce。
 */
export function transcriptReducer(
  state: TranscriptState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evt: BackendEvent | Record<string, any>,
): TranscriptState {
  // 若已是标准 BackendEvent（含 kind 字段），直接转发
  if (typeof (evt as BackendEvent).kind === 'string') {
    return reduce(state, evt as BackendEvent)
  }
  // 扁平形式：{ type: 'plan.created', planId, ... } → 规范化为通知
  const { type: method, ...rest } = evt as Record<string, unknown>
  if (typeof method !== 'string') return state
  return reduce(state, { kind: 'notification', method, params: rest })
}

/** 公开别名：核心 reduce 的直调形式（标准 BackendEvent），供测试用简短名 `reducer` 引用。 */
export const reducer = reduce

/** 返回一份新的 initialState 拷贝（防止测试间共享同一引用）。 */
export function initialTranscriptState(): TranscriptState {
  return { ...initialState }
}

/** 返回空白的 TranscriptState（spliceCards 回放专用别名）。 */
export function freshState(): TranscriptState {
  return { ...initialState }
}

/** 提交时 echo 一条 user 气泡(封口当前 message)。 */
export function addUserItem(state: TranscriptState, text: string, attachments?: AttachmentRef[]): TranscriptState {
  const item: Item = attachments && attachments.length > 0
    ? { type: 'user', text, attachments }
    : { type: 'user', text }
  return { ...state, items: [...state.items, item], _messageOpen: false }
}

/**
 * 追加一条「后台任务已完成」药丸。与 system-event 分开是因为语义不同:
 * system-event 会作为带前缀的 user 消息回到后端历史(可能引出一轮回复),
 * 而任务完成只是通知,不该进历史、也不该让 agent 说话 —— 它只需要可点开看结果。
 */
export function addTaskDoneItem(
  state: TranscriptState, taskId: string, text: string, ok: boolean,
): TranscriptState {
  if (state.items.some((i) => i.type === 'task-done' && i.taskId === taskId)) return state // 幂等:轮询重入不重复插
  return { ...state, items: [...state.items, { type: 'task-done', taskId, text, ok }], _messageOpen: false }
}

/** 追加一条系统事件气泡(封口当前 message),与 addUserItem 对称。 */
export function addSystemEventItem(state: TranscriptState, text: string): TranscriptState {
  return { ...state, items: [...state.items, { type: 'system-event', text }], _messageOpen: false }
}

/**
 * turn.failed 的错误文案净化:剥 URL / sk- / Bearer token,压平空白,截断到 300 字符。
 * 防止把长内部路径或潜在敏感串带进对话气泡。纯函数,可测。
 */
export function sanitizeErrorText(raw: string): string {
  if (!raw) return ''
  const cleaned = raw
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [key]')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 300 ? cleaned.slice(0, 300) + '…' : cleaned
}

/** 真回溯的本地裁剪:裁掉第 ordinal 个 user 项(1-based,含)及之后全部;超界/无效原样返回。 */
export function truncateAtUserOrdinal(state: TranscriptState, ordinal: number): TranscriptState {
  if (ordinal < 1) return state
  let seen = 0
  for (let i = 0; i < state.items.length; i++) {
    if (state.items[i].type === 'user') {
      seen++
      if (seen === ordinal) {
        return { ...state, items: state.items.slice(0, i), _messageOpen: false }
      }
    }
  }
  return state
}
