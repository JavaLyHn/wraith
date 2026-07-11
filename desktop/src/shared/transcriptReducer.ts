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

import type { BackendEvent, StatusData, PlanStepView } from './types'

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

export type Item =
  | { type: 'user'; text: string; attachments?: AttachmentRef[] }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'thinking'; label: string; text: string; done: boolean }
  | { type: 'tool'; card: ToolCard }
  | { type: 'diff'; filePath: string; before: string; after: string }
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
  /** 沙箱状态(来自 initialize.capabilities.sandbox)。 */
  sandbox: 'macos-seatbelt' | 'none' | 'unknown'
  /** token 状态(status 事件,resetSession 清空)。 */
  status: StatusData | null
  /** Internal flag: true when the last message item is still open for appending. */
  _messageOpen: boolean
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: TranscriptState = {
  items: [],
  pendingApproval: null,
  turn: 'idle',
  connection: 'disconnected',
  model: '',
  hasStarted: false,
  approvalMode: 'ask',
  workspace: '',
  sessionId: '',
  sandbox: 'unknown',
  status: null,
  _messageOpen: false,
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
      return { ...state, turn: 'running', ...(sid ? { sessionId: sid } : {}) }
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
    workspace: ws,
    sessionId: '',
    status: null,
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

/** 设置沙箱状态。 */
export function setSandbox(state: TranscriptState, sandbox: 'macos-seatbelt' | 'none' | 'unknown'): TranscriptState {
  return { ...state, sandbox }
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
