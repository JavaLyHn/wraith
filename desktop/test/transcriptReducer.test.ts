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
