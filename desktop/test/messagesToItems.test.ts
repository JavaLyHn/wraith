import { describe, it, expect } from 'vitest'
import { messagesToItems } from '../src/shared/messagesToItems'
import type { ResumedMessage } from '../src/shared/types'

describe('messagesToItems', () => {
  it('maps user → user item', () => {
    const items = messagesToItems([{ role: 'user', content: 'hi' }])
    expect(items).toEqual([{ type: 'user', text: 'hi' }])
  })

  it('assistant reasoning precedes content', () => {
    const items = messagesToItems([{ role: 'assistant', content: 'answer', reasoningContent: 'thinking' }])
    expect(items[0]).toEqual({ type: 'thinking', label: '', text: 'thinking', done: true })
    expect(items[1]).toEqual({ type: 'message', text: 'answer' })
  })

  it('assistant toolCalls → tool cards, tool message fills output by callId', () => {
    const msgs: ResumedMessage[] = [
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'run', arguments: '{"cmd":"ls"}' }] },
      { role: 'tool', content: 'file.txt', toolCallId: 'c1' },
    ]
    const items = messagesToItems(msgs)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      type: 'tool',
      card: { callId: 'c1', name: 'run', argsJson: '{"cmd":"ls"}', output: 'file.txt', done: true, ok: true },
    })
  })

  it('empty → []', () => {
    expect(messagesToItems([])).toEqual([])
  })

  it('skips system', () => {
    expect(messagesToItems([{ role: 'system', content: 'x' }])).toEqual([])
  })
})
