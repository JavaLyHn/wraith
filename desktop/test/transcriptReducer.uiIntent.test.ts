import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState, type Item } from '../src/shared/transcriptReducer'

function lastItem(items: Item[]): Item { return items[items.length - 1] }

describe('transcriptReducer —— open_panel 特判', () => {
  it('open_panel 的 tool.call 归约成 action item(非 tool card)', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c1', name: 'open_panel', argsJson: '{"panel":"im-gateway"}',
    })
    const it = lastItem(s.items)
    expect(it.type).toBe('action')
    expect((it as { type: 'action'; panel: string }).panel).toBe('im-gateway')
  })
  it('普通工具仍归约成 tool card', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c2', name: 'read_file', argsJson: '{"path":"a.txt"}',
    })
    expect(lastItem(s.items).type).toBe('tool')
  })
  it('argsJson 非法时 panel 回退空串,不抛', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c3', name: 'open_panel', argsJson: 'not-json',
    })
    const it = lastItem(s.items)
    expect(it.type).toBe('action')
    expect((it as { type: 'action'; panel: string }).panel).toBe('')
  })
})
