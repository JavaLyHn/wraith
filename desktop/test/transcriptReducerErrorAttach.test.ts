/**
 * turn.failed 错误显示 + 用户消息附件 + 错误文案净化。纯 TS,无 React/Electron。
 */
import { describe, it, expect } from 'vitest'
import { reduce, addUserItem, sanitizeErrorText, initialState } from '../src/shared/transcriptReducer'
import type { BackendEvent } from '../src/shared/types'

function notif(method: string, params: Record<string, unknown> = {}): BackendEvent {
  return { kind: 'notification', method, params }
}

describe('turn.failed 显示错误', () => {
  it('带 error → 追加 error item 且归 idle', () => {
    const s0 = { ...initialState, turn: 'running' as const }
    const s = reduce(s0, notif('turn.failed', { error: '模型不支持图片输入' }))
    expect(s.turn).toBe('idle')
    const last = s.items[s.items.length - 1]
    expect(last).toEqual({ type: 'error', text: '模型不支持图片输入' })
  })

  it('无 error → 只归 idle,不加 item', () => {
    const s0 = { ...initialState, turn: 'running' as const }
    const s = reduce(s0, notif('turn.failed', {}))
    expect(s.turn).toBe('idle')
    expect(s.items).toHaveLength(0)
  })
})

describe('addUserItem 附件', () => {
  it('带附件 → user item 含 attachments', () => {
    const s = addUserItem(initialState, '这个图说了什么', [{ path: '/tmp/a.png', name: 'a.png', kind: 'image' }])
    expect(s.items[0]).toEqual({
      type: 'user',
      text: '这个图说了什么',
      attachments: [{ path: '/tmp/a.png', name: 'a.png', kind: 'image' }],
    })
  })

  it('无附件 → 不带 attachments 字段', () => {
    const s = addUserItem(initialState, '你好')
    expect(s.items[0]).toEqual({ type: 'user', text: '你好' })
  })

  it('空数组 → 不带 attachments 字段', () => {
    const s = addUserItem(initialState, '你好', [])
    expect(s.items[0]).toEqual({ type: 'user', text: '你好' })
  })
})

describe('sanitizeErrorText', () => {
  it('空 → 空', () => expect(sanitizeErrorText('')).toBe(''))
  it('剥 URL', () => expect(sanitizeErrorText('failed at https://api.x.com/v1/chat now')).toBe('failed at [url] now'))
  it('剥 sk- key', () => expect(sanitizeErrorText('key sk-abc123DEF used')).toBe('key [key] used'))
  it('剥 Bearer', () => expect(sanitizeErrorText('auth Bearer tok_secret')).toBe('auth Bearer [key]'))
  it('压平空白', () => expect(sanitizeErrorText('a\n\n  b')).toBe('a b'))
  it('超 300 截断加省略号', () => {
    const long = 'x'.repeat(400)
    const out = sanitizeErrorText(long)
    expect(out.length).toBe(301)
    expect(out.endsWith('…')).toBe(true)
  })
})
