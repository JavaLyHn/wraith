import { describe, it, expect } from 'vitest'
import { applyBindEvent, type BindState } from '../src/renderer/lib/imBind'

describe('applyBindEvent', () => {
  it('scanning 阶段保留先到的 qr(后一条无 qr 不冲掉)', () => {
    let s: BindState | null = null
    s = applyBindEvent(s, { kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' })
    expect(s.qr).toBe('data:image/png;base64,AAA')
    s = applyBindEvent(s, { kind: 'bind', phase: 'scanning', url: 'https://x' })
    expect(s.qr).toBe('data:image/png;base64,AAA') // 仍在
    expect(s.url).toBe('https://x')
  })
  it('非 scanning 阶段清空 qr/url', () => {
    const prev: BindState = { phase: 'scanning', qr: 'data:...', url: 'https://x' }
    const s = applyBindEvent(prev, { kind: 'bind', phase: 'bound' })
    expect(s.phase).toBe('bound')
    expect(s.qr).toBeUndefined()
    expect(s.url).toBeUndefined()
  })
})
