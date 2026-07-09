import { describe, it, expect } from 'vitest'
import { selectAction, resolveOnIdle, deriveView, type Preview } from '../src/shared/sessionPreview'
import type { Item } from '../src/shared/transcriptReducer'

const A: Item[] = [{ type: 'user', ordinal: 1, text: 'A-hi' } as unknown as Item]
const LIVE: Item[] = [{ type: 'user', ordinal: 1, text: 'live' } as unknown as Item]

describe('selectAction', () => {
  it('running + 点 live 行 → 返回 live', () => {
    expect(selectAction('running', 's-live', 's-live')).toEqual({ mode: 'preview-return' })
  })
  it('running + 点别的会话 → 打开预览', () => {
    expect(selectAction('running', 's-other', 's-live')).toEqual({ mode: 'preview-open', sessionId: 's-other' })
  })
  it('idle → 完整切换', () => {
    expect(selectAction('idle', 's-other', 's-live')).toEqual({ mode: 'full-switch', sessionId: 's-other' })
  })
})

describe('resolveOnIdle', () => {
  it('null → none', () => expect(resolveOnIdle(null)).toEqual({ action: 'none' }))
  it('session → resume+id', () =>
    expect(resolveOnIdle({ kind: 'session', sessionId: 'x', items: A })).toEqual({ action: 'resume', sessionId: 'x' }))
  it('new → new', () => expect(resolveOnIdle({ kind: 'new' })).toEqual({ action: 'new' }))
})

describe('deriveView', () => {
  const live = { sessionId: 's-live', items: LIVE, hasStarted: true, turn: 'running' as const }

  it('看 live(running)→ 渲染 live.items,busy,无横幅', () => {
    expect(deriveView(null, live)).toEqual({
      items: LIVE, activeSessionId: 's-live', runningSessionId: 's-live',
      showWelcome: false, transcriptBusy: true, showReturnBanner: false,
    })
  })
  it('看 live(idle 未开始)→ welcome,不 busy', () => {
    expect(deriveView(null, { ...live, hasStarted: false, turn: 'idle' })).toEqual({
      items: LIVE, activeSessionId: 's-live', runningSessionId: '',
      showWelcome: true, transcriptBusy: false, showReturnBanner: false,
    })
  })
  it('预览会话 X(running)→ 渲染 X.items,不 busy,有横幅,脉动指向 live', () => {
    const p: Preview = { kind: 'session', sessionId: 's-x', items: A }
    expect(deriveView(p, live)).toEqual({
      items: A, activeSessionId: 's-x', runningSessionId: 's-live',
      showWelcome: false, transcriptBusy: false, showReturnBanner: true,
    })
  })
  it('预览新会话(running)→ 空 welcome,有横幅', () => {
    expect(deriveView({ kind: 'new' }, live)).toEqual({
      items: [], activeSessionId: '', runningSessionId: 's-live',
      showWelcome: true, transcriptBusy: false, showReturnBanner: true,
    })
  })
  it('预览会话但 turn 已 idle(落定前一瞬)→ 无横幅、脉动清空', () => {
    const p: Preview = { kind: 'session', sessionId: 's-x', items: A }
    expect(deriveView(p, { ...live, turn: 'idle' })).toEqual({
      items: A, activeSessionId: 's-x', runningSessionId: '',
      showWelcome: false, transcriptBusy: false, showReturnBanner: false,
    })
  })
})
