import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter } from '../src/shared/composerKeys'

const base = { key: 'Enter', shiftKey: false, isComposing: false }

describe('shouldSendOnEnter', () => {
  it('普通 Enter → 发送', () => {
    expect(shouldSendOnEnter(base, false)).toBe(true)
  })
  it('Shift+Enter → 不发送(换行)', () => {
    expect(shouldSendOnEnter({ ...base, shiftKey: true }, false)).toBe(false)
  })
  it('IME 组合态的 Enter(选词确认)→ 不发送', () => {
    expect(shouldSendOnEnter({ ...base, isComposing: true }, false)).toBe(false)
  })
  it('keyCode 229(Safari/旧 Chromium IME 会话)→ 不发送', () => {
    expect(shouldSendOnEnter({ ...base, keyCode: 229 }, false)).toBe(false)
  })
  it('running 中 → 不发送(可打草稿)', () => {
    expect(shouldSendOnEnter(base, true)).toBe(false)
  })
  it('非 Enter 键 → 不发送', () => {
    expect(shouldSendOnEnter({ ...base, key: 'a' }, false)).toBe(false)
  })
})
