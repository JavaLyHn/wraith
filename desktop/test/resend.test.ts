import { describe, it, expect } from 'vitest'
import { lastUserMessage } from '../src/renderer/lib/resend'
import type { Item } from '../src/shared/transcriptReducer'

const user = (text: string): Item => ({ type: 'user', text })
const agent = (text: string): Item => ({ type: 'message', text })

describe('lastUserMessage', () => {
  it('多条用户消息取最后一条(ordinal 1-based + text)', () => {
    const items: Item[] = [user('a'), agent('r1'), user('b'), agent('r2')]
    expect(lastUserMessage(items)).toEqual({ ordinal: 2, text: 'b' })
  })
  it('夹杂 agent/thinking 项不误算 user 序号', () => {
    const items: Item[] = [
      user('one'),
      { type: 'thinking', label: 'x', text: '', done: true },
      agent('r'),
      user('two'),
    ]
    expect(lastUserMessage(items)).toEqual({ ordinal: 2, text: 'two' })
  })
  it('无用户消息返回 null', () => {
    expect(lastUserMessage([agent('r')])).toBeNull()
    expect(lastUserMessage([])).toBeNull()
  })
})
