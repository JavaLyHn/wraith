/**
 * TDD tests for transcriptReducer — pure TS, no React/Electron.
 *
 * Run: npx vitest run test/transcriptReducer.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  reduce,
  clearApproval,
  setModel,
  markStarted,
  setApprovalMode,
  setWorkspace,
  resetSession,
  loadHistory,
  setSessionId,
  setSandbox,
  addUserItem,
  initialState,
  type TranscriptState,
} from '../src/shared/transcriptReducer'
import type { BackendEvent } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a notification BackendEvent */
function notif(method: string, params: Record<string, unknown> = {}): BackendEvent {
  return { kind: 'notification', method, params }
}

function connEvt(state: 'connected' | 'disconnected'): BackendEvent {
  return { kind: 'connection', state }
}

// ---------------------------------------------------------------------------
// Test 1: message.delta accumulates; message.end starts a new bubble
// ---------------------------------------------------------------------------
describe('message items', () => {
  it('two consecutive message.delta → ONE message item with combined text', () => {
    let s = initialState
    s = reduce(s, notif('message.delta', { text: 'hello ' }))
    s = reduce(s, notif('message.delta', { text: 'world' }))

    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ type: 'message', text: 'hello world' })
  })

  it('after message.end, the next message.delta starts a NEW message item', () => {
    let s = initialState
    s = reduce(s, notif('message.delta', { text: 'first' }))
    s = reduce(s, notif('message.end'))
    s = reduce(s, notif('message.delta', { text: 'second' }))

    expect(s.items).toHaveLength(2)
    expect(s.items[0]).toMatchObject({ type: 'message', text: 'first' })
    expect(s.items[1]).toMatchObject({ type: 'message', text: 'second' })
  })
})

// ---------------------------------------------------------------------------
// Test 2: thinking lifecycle
// ---------------------------------------------------------------------------
describe('thinking items', () => {
  it('thinking.begin/delta/delta/end → one item, text accumulated, done=true', () => {
    let s = initialState
    s = reduce(s, notif('thinking.begin', { label: 'Reasoning' }))
    s = reduce(s, notif('thinking.delta', { text: 'step one' }))
    s = reduce(s, notif('thinking.delta', { text: ' step two' }))
    s = reduce(s, notif('thinking.end'))

    expect(s.items).toHaveLength(1)
    const item = s.items[0]
    expect(item.type).toBe('thinking')
    if (item.type === 'thinking') {
      expect(item.label).toBe('Reasoning')
      expect(item.text).toBe('step one step two')
      expect(item.done).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3: tool.call + multiple tool.output.delta accumulate; tool.result seals
// ---------------------------------------------------------------------------
describe('tool items – single card', () => {
  it('tool.call → card created; tool.output.delta accumulates; tool.result seals', () => {
    let s = initialState
    s = reduce(s, notif('tool.call', { callId: 'c1', name: 'bash', argsJson: '{}' }))
    s = reduce(s, notif('tool.output.delta', { callId: 'c1', stream: 'stdout', chunk: 'line1' }))
    s = reduce(s, notif('tool.output.delta', { callId: 'c1', stream: 'stdout', chunk: 'line2' }))
    s = reduce(s, notif('tool.result', { callId: 'c1', ok: true, exitCode: 0 }))

    expect(s.items).toHaveLength(1)
    const item = s.items[0]
    expect(item.type).toBe('tool')
    if (item.type === 'tool') {
      const card = item.card
      expect(card.callId).toBe('c1')
      expect(card.name).toBe('bash')
      expect(card.output).toBe('line1\nline2\n')
      expect(card.ok).toBe(true)
      expect(card.exitCode).toBe(0)
      expect(card.done).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 4: two different callIds → NO cross-contamination
// ---------------------------------------------------------------------------
describe('tool items – two cards', () => {
  it('tool.output.delta for different callIds go to their own cards', () => {
    let s = initialState
    s = reduce(s, notif('tool.call', { callId: 'A', name: 'read', argsJson: '{}' }))
    s = reduce(s, notif('tool.call', { callId: 'B', name: 'write', argsJson: '{}' }))
    s = reduce(s, notif('tool.output.delta', { callId: 'A', stream: 'stdout', chunk: 'fromA' }))
    s = reduce(s, notif('tool.output.delta', { callId: 'B', stream: 'stdout', chunk: 'fromB' }))

    const cards = s.items.filter(i => i.type === 'tool').map(i => (i as Extract<typeof i, {type:'tool'}>).card)
    const cardA = cards.find(c => c.callId === 'A')
    const cardB = cards.find(c => c.callId === 'B')

    expect(cardA?.output).toBe('fromA\n')
    expect(cardB?.output).toBe('fromB\n')
  })
})

// ---------------------------------------------------------------------------
// Test 5: approval.requested + clearApproval
// ---------------------------------------------------------------------------
describe('approval', () => {
  it('approval.requested sets pendingApproval', () => {
    const s = reduce(
      initialState,
      notif('approval.requested', {
        approvalId: 'ap1',
        toolName: 'bash',
        argsJson: '{"cmd":"rm"}',
        dangerLevel: 'high',
        riskDescription: 'deletes files',
      }),
    )
    expect(s.pendingApproval).toMatchObject({
      approvalId: 'ap1',
      toolName: 'bash',
      dangerLevel: 'high',
      riskDescription: 'deletes files',
      suggestion: '',
      beforeContent: null,
    })
  })

  it('clearApproval → pendingApproval is null', () => {
    let s = reduce(
      initialState,
      notif('approval.requested', {
        approvalId: 'ap1',
        toolName: 'bash',
        argsJson: '{}',
        dangerLevel: 'low',
        riskDescription: 'ok',
      }),
    )
    s = clearApproval(s)
    expect(s.pendingApproval).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 6: turn + connection state transitions
// ---------------------------------------------------------------------------
describe('turn and connection', () => {
  it('turn.started → running; turn.completed → idle', () => {
    let s = reduce(initialState, notif('turn.started'))
    expect(s.turn).toBe('running')

    s = reduce(s, notif('turn.completed'))
    expect(s.turn).toBe('idle')
  })

  it('turn.failed → idle', () => {
    let s = reduce(initialState, notif('turn.started'))
    s = reduce(s, notif('turn.failed'))
    expect(s.turn).toBe('idle')
  })

  it('connection disconnected → turn idle and connection disconnected', () => {
    let s = reduce(initialState, notif('turn.started'))
    expect(s.turn).toBe('running')

    s = reduce(s, connEvt('disconnected'))
    expect(s.connection).toBe('disconnected')
    expect(s.turn).toBe('idle')
  })

  it('connection connected → connection connected, turn unchanged', () => {
    const s = reduce(initialState, connEvt('connected'))
    expect(s.connection).toBe('connected')
    expect(s.turn).toBe('idle') // unchanged
  })
})

// ---------------------------------------------------------------------------
// Test 7: unknown notification → state unchanged (deep equal)
// ---------------------------------------------------------------------------
describe('unknown notification', () => {
  it('unknown method returns state with equal content', () => {
    const s = reduce(initialState, notif('some.unknown.method', { foo: 'bar' }))
    expect(s).toEqual(initialState)
  })
})

// ---------------------------------------------------------------------------
// Test 8: immutability — reduce returns a NEW object; input is not mutated
// ---------------------------------------------------------------------------
describe('immutability', () => {
  it('reduce returns a new state object, does not mutate input', () => {
    const before = initialState
    const after = reduce(before, notif('turn.started'))

    expect(after).not.toBe(before) // different reference
    expect(before.turn).toBe('idle') // original not mutated
  })

  it('appending a message item does not mutate the input items array', () => {
    const before = initialState
    const after = reduce(before, notif('message.delta', { text: 'hi' }))

    expect(after.items).not.toBe(before.items)
    expect(before.items).toHaveLength(0)
  })

  it('tool.output.delta does not mutate the existing card in the prior state', () => {
    let s1 = reduce(initialState, notif('tool.call', { callId: 'x', name: 'bash', argsJson: '{}' }))
    const toolItem1 = s1.items.find(i => i.type === 'tool') as Extract<typeof s1.items[0], { type: 'tool' }>
    const cardBefore = toolItem1.card
    const s2 = reduce(s1, notif('tool.output.delta', { callId: 'x', stream: 'stdout', chunk: 'hi' }))

    // prior state's card object is untouched (same ref, empty output)
    const toolItemStillInS1 = s1.items.find(i => i.type === 'tool') as Extract<typeof s1.items[0], { type: 'tool' }>
    expect(toolItemStillInS1.card).toBe(cardBefore)
    expect(cardBefore.output).toBe('')

    // new state got a NEW card object with the appended output
    const toolItem2 = s2.items.find(i => i.type === 'tool') as Extract<typeof s2.items[0], { type: 'tool' }>
    expect(toolItem2.card).not.toBe(cardBefore)
    expect(toolItem2.card.output).toBe('hi\n')
  })
})

// ---------------------------------------------------------------------------
// Test 9: setModel helper
// ---------------------------------------------------------------------------
describe('setModel', () => {
  it('setModel returns a new state with updated model', () => {
    const s = setModel(initialState, 'deepseek-chat')
    expect(s.model).toBe('deepseek-chat')
    expect(s).not.toBe(initialState)
  })
})

// ---------------------------------------------------------------------------
// Test 10: phase-A state additions
// ---------------------------------------------------------------------------
describe('phase-A state additions', () => {
  it('initialState has hasStarted=false, approvalMode=ask, workspace=""', () => {
    expect(initialState.hasStarted).toBe(false)
    expect(initialState.approvalMode).toBe('ask')
    expect(initialState.workspace).toBe('')
  })

  it('markStarted flips hasStarted immutably and is idempotent', () => {
    const s1 = markStarted(initialState)
    expect(s1.hasStarted).toBe(true)
    expect(initialState.hasStarted).toBe(false) // original untouched
    const s2 = markStarted(s1)
    expect(s2.hasStarted).toBe(true)
  })

  it('setApprovalMode toggles ask/auto immutably', () => {
    const auto = setApprovalMode(initialState, 'auto')
    expect(auto.approvalMode).toBe('auto')
    expect(initialState.approvalMode).toBe('ask')
    const back = setApprovalMode(auto, 'ask')
    expect(back.approvalMode).toBe('ask')
  })

  it('setWorkspace sets workspace immutably', () => {
    const s = setWorkspace(initialState, '/tmp/proj')
    expect(s.workspace).toBe('/tmp/proj')
    expect(initialState.workspace).toBe('')
  })

  it('resetSession clears items+hasStarted+approvalMode, keeps model+connection', () => {
    let s: TranscriptState = { ...initialState, connection: 'connected', model: 'deepseek', approvalMode: 'auto', hasStarted: true }
    s = reduce(s, { kind: 'notification', method: 'message.delta', params: { text: 'x' } })
    expect(s.items.length).toBe(1)
    const r = resetSession(s, '/new/dir')
    expect(r.items).toEqual([])
    expect(r.hasStarted).toBe(false)
    expect(r.approvalMode).toBe('ask')
    expect(r.pendingApproval).toBeNull()
    expect(r.workspace).toBe('/new/dir')
    expect(r._messageOpen).toBe(false)
    expect(r.model).toBe('deepseek')      // preserved
    expect(r.connection).toBe('connected') // preserved
    // original untouched
    expect(s.items.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 11: phase-B state additions
// ---------------------------------------------------------------------------
describe('phase-B state additions', () => {
  it('initial has sessionId="" and sandbox="unknown"', () => {
    expect(initialState.sessionId).toBe('')
    expect(initialState.sandbox).toBe('unknown')
  })
  it('loadHistory replaces items immutably', () => {
    const s = loadHistory(initialState, [{ type: 'user', text: 'x' }])
    expect(s.items).toEqual([{ type: 'user', text: 'x' }])
    expect(s._messageOpen).toBe(false)
    expect(initialState.items).toEqual([])
  })
  it('setSessionId / setSandbox', () => {
    expect(setSessionId(initialState, 'abc').sessionId).toBe('abc')
    expect(setSandbox(initialState, 'none').sandbox).toBe('none')
  })
  it('addUserItem appends a user item', () => {
    const s = addUserItem(initialState, 'hello')
    expect(s.items[s.items.length - 1]).toEqual({ type: 'user', text: 'hello' })
    expect(s._messageOpen).toBe(false)
  })
  it('turn.completed with sessionId updates sessionId', () => {
    const s = reduce(initialState, { kind: 'notification', method: 'turn.completed', params: { sessionId: 'sess-real' } })
    expect(s.turn).toBe('idle')
    expect(s.sessionId).toBe('sess-real')
  })
  it('turn.completed without sessionId keeps the existing sessionId', () => {
    const start: TranscriptState = { ...initialState, sessionId: 'existing' }
    const s = reduce(start, { kind: 'notification', method: 'turn.completed', params: {} })
    expect(s.turn).toBe('idle')
    expect(s.sessionId).toBe('existing')
  })
  it('turn.failed goes idle and never touches sessionId, even if params carry one', () => {
    const start: TranscriptState = { ...initialState, turn: 'running', sessionId: 'existing' }
    const s = reduce(start, { kind: 'notification', method: 'turn.failed', params: { sessionId: 'sneaky' } })
    expect(s.turn).toBe('idle')
    expect(s.sessionId).toBe('existing')
  })
  it('loadHistory preserves all non-transcript fields', () => {
    const start: TranscriptState = {
      ...initialState,
      model: 'deepseek',
      workspace: '/proj/a',
      sessionId: 'sess-1',
      sandbox: 'macos-seatbelt',
      hasStarted: true,
      approvalMode: 'auto',
      connection: 'connected',
    }
    const s = loadHistory(start, [{ type: 'user', text: 'x' }])
    expect(s.items).toEqual([{ type: 'user', text: 'x' }])
    expect(s.model).toBe('deepseek')
    expect(s.workspace).toBe('/proj/a')
    expect(s.sessionId).toBe('sess-1')
    expect(s.sandbox).toBe('macos-seatbelt')
    expect(s.hasStarted).toBe(true)
    expect(s.approvalMode).toBe('auto')
    expect(s.connection).toBe('connected')
  })
})

// ---------------------------------------------------------------------------
// Test 12: phase-C: diff / status / approval 扩展
// ---------------------------------------------------------------------------
describe('phase-C: diff / status / approval 扩展', () => {
  it('diff event appends a diff item and seals _messageOpen (file key)', () => {
    const open: TranscriptState = { ...initialState, _messageOpen: true }
    const s = reduce(open, notif('diff', { file: 'src/a.ts', before: 'x', after: 'y' }))
    expect(s.items[s.items.length - 1]).toEqual({ type: 'diff', filePath: 'src/a.ts', before: 'x', after: 'y' })
    expect(s._messageOpen).toBe(false)
  })
  it('diff event backward-compat: filePath key also works', () => {
    const s = reduce(initialState, notif('diff', { filePath: 'src/b.ts', before: 'a', after: 'b' }))
    const item = s.items[s.items.length - 1]
    expect(item).toMatchObject({ type: 'diff', filePath: 'src/b.ts' })
  })
  it('status event maps the payload subset', () => {
    const s = reduce(initialState, notif('status', { status: {
      model: 'm', totalTokens: 1200, contextWindow: 64000, inputTokens: 900, outputTokens: 300,
      cachedInputTokens: 500, estimatedCost: '¥0.01', hitlEnabled: true, elapsedMillis: 800, phase: 'running',
    } }))
    expect(s.status).toEqual({
      model: 'm', totalTokens: 1200, contextWindow: 64000, inputTokens: 900, outputTokens: 300,
      cachedInputTokens: 500, estimatedCost: '¥0.01', elapsedMillis: 800, phase: 'running',
    })
  })
  it('status event without payload leaves state unchanged', () => {
    expect(reduce(initialState, notif('status', {}))).toEqual(initialState)
  })
  it('resetSession clears status', () => {
    const withStatus: TranscriptState = { ...initialState, status: {
      model: 'm', totalTokens: 1, contextWindow: 2, inputTokens: 0, outputTokens: 0,
      cachedInputTokens: 0, estimatedCost: null, elapsedMillis: 0, phase: 'idle' } }
    expect(resetSession(withStatus, '/w').status).toBeNull()
  })
  it('approval.requested carries suggestion and beforeContent (with defaults)', () => {
    const s = reduce(initialState, notif('approval.requested', {
      approvalId: 'a1', toolName: 'write_file', argsJson: '{}',
      dangerLevel: '🟡 中危', riskDescription: 'r', suggestion: '要写文件', beforeContent: 'old',
    }))
    expect(s.pendingApproval?.suggestion).toBe('要写文件')
    expect(s.pendingApproval?.beforeContent).toBe('old')
    const s2 = reduce(initialState, notif('approval.requested', { approvalId: 'a2', toolName: 't', argsJson: '{}' }))
    expect(s2.pendingApproval?.suggestion).toBe('')
    expect(s2.pendingApproval?.beforeContent).toBeNull()
  })
})
