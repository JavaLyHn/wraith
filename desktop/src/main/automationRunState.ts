export interface RunState {
  phase: 'starting' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'interrupted'
  summaryBuf: string
  lastMessage: string
  approval: { approvalId: string; payload: Record<string, unknown> } | null
  sessionId?: string
  error?: string
}

export type RunEvent =
  | { type: 'turn-submitted' }
  | { type: 'notification'; method: string; params: Record<string, unknown> }
  | { type: 'approval-responded' }
  | { type: 'child-exit' }          // 意外退出(未 kill)
  | { type: 'stopped' }             // main 主动终止

const TERMINAL = new Set(['success', 'failed', 'interrupted'])

export function initialRunState(): RunState {
  return { phase: 'starting', summaryBuf: '', lastMessage: '', approval: null }
}

export function applyRunEvent(s: RunState, e: RunEvent): RunState {
  if (TERMINAL.has(s.phase)) return s
  switch (e.type) {
    case 'turn-submitted':
      return { ...s, phase: 'running' }
    case 'approval-responded':
      return { ...s, phase: 'running', approval: null }
    case 'child-exit':
      return { ...s, phase: 'failed', error: '子进程意外退出' }
    case 'stopped':
      return { ...s, phase: 'interrupted' }
    case 'notification': {
      const p = e.params
      switch (e.method) {
        case 'message.delta':
          return { ...s, summaryBuf: s.summaryBuf + String(p['text'] ?? '') }
        case 'message.end':
          return { ...s, lastMessage: s.summaryBuf, summaryBuf: '' }
        case 'approval.requested':
          return { ...s, phase: 'waiting_approval', approval: { approvalId: String(p['approvalId']), payload: p } }
        case 'turn.completed':
          return { ...s, phase: 'success', sessionId: p['sessionId'] != null ? String(p['sessionId']) : undefined }
        case 'turn.failed':
          return { ...s, phase: 'failed', error: p['error'] != null ? String(p['error']) : undefined }
        default:
          return s
      }
    }
  }
}

export function summaryOf(s: RunState): string {
  // Guard: lastMessage/summaryBuf may be undefined when called with a partial RunState
  // (e.g. stopAll() passes { phase: 'interrupted' } as RunState — no summaryBuf/lastMessage).
  const text = s.lastMessage || s.summaryBuf || ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}
