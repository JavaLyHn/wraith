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

import type { BackendEvent } from './types'

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

export type Item =
  | { type: 'message'; text: string }
  | { type: 'thinking'; label: string; text: string; done: boolean }
  | { type: 'tool'; card: ToolCard }

export interface TranscriptState {
  items: Item[]
  pendingApproval: {
    approvalId: string
    toolName: string
    argsJson: string
    dangerLevel: string
    riskDescription: string
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
    case 'turn.started':
      return { ...state, turn: 'running' }

    case 'turn.completed':
    case 'turn.failed':
      return { ...state, turn: 'idle' }

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
      return {
        ...state,
        pendingApproval: { approvalId, toolName, argsJson, dangerLevel, riskDescription },
      }
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

/** 前门：标记会话已开始（首条消息发出时同步调用）。 */
export function markStarted(state: TranscriptState): TranscriptState {
  return { ...state, hasStarted: true }
}

/** 设置审批模式（UI 开关驱动）。 */
export function setApprovalMode(state: TranscriptState, mode: 'ask' | 'auto'): TranscriptState {
  return { ...state, approvalMode: mode }
}

/** 设置当前工作目录。 */
export function setWorkspace(state: TranscriptState, ws: string): TranscriptState {
  return { ...state, workspace: ws }
}

/** 重选目录后重置为新会话（清空 transcript，回欢迎态，审批归 ask；保留 model/connection）。 */
export function resetSession(state: TranscriptState, ws: string): TranscriptState {
  return {
    ...state,
    items: [],
    _messageOpen: false,
    hasStarted: false,
    approvalMode: 'ask',
    pendingApproval: null,
    workspace: ws,
  }
}
