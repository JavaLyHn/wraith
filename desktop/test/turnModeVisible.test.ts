import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState, addUserItem } from '../src/shared/transcriptReducer'
import type { TranscriptState } from '../src/shared/transcriptReducer'

/**
 * 「不能知道 agent 当前有没有感知到模式的切换」。
 *
 * 此前模式是一条**单向**的线:前端 pendingMode(一个 React state)→ turn.submit 的
 * mode 参数 → 后端分支。切换不留痕、不回声,于是用户无从确认;而模型也从没被告知过
 * 现值,只能从对话历史里推(那就是它说「你当前处于 Plan 模式」的由来)。
 *
 * 现在 turn.started 回声**归一化之后**的模式(= 后端真正要用的那个),前端把它记在
 * 那一条用户气泡上 —— 每一轮都留下一条可核对的记录。
 */

const ev = (method: string, params: unknown) => ({ kind: 'notification' as const, method, params })

function lastUser(state: TranscriptState) {
  const users = state.items.filter(i => i.type === 'user')
  return users[users.length - 1] as { type: 'user'; text: string; mode?: string } | undefined
}

describe('每一轮的实际模式记在用户气泡上', () => {
  it('turn.started 的 mode 落到刚提交的那条气泡', () => {
    let s = addUserItem(initialTranscriptState(), '帮我分析一下')
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't1', mode: 'plan' }))
    expect(lastUser(s)?.mode).toBe('plan')
  })

  it('只标最后一条:前面几轮各自保留自己那轮的模式', () => {
    let s = addUserItem(initialTranscriptState(), '第一问')
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't1', mode: 'plan' }))
    s = addUserItem(s, '第二问')
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't2', mode: 'react' }))

    const users = s.items.filter(i => i.type === 'user') as { mode?: string }[]
    expect(users.map(u => u.mode)).toEqual(['plan', 'react'])
  })

  it('老后端不回声 mode 时不写字段(不臆造一个 react)', () => {
    let s = addUserItem(initialTranscriptState(), '问题')
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't1' }))
    expect(lastUser(s)?.mode).toBeUndefined()
  })

  it('认不出来的值不写 —— UI 不该显示一个不存在的模式', () => {
    let s = addUserItem(initialTranscriptState(), '问题')
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't1', mode: 'planx' }))
    expect(lastUser(s)?.mode).toBeUndefined()
  })

  it('没有用户气泡时(如自动化触发的轮次)不炸', () => {
    const s = transcriptReducer(initialTranscriptState(),
      ev('turn.started', { sessionId: 's1', turnId: 't1', mode: 'team' }))
    expect(s.turn).toBe('running')
    expect(s.items.filter(i => i.type === 'user')).toHaveLength(0)
  })

  it('turn.started 原有职责没丢:置 running + 认领 sessionId', () => {
    const s = transcriptReducer(initialTranscriptState(),
      ev('turn.started', { sessionId: 'real-sid', turnId: 't1', mode: 'react' }))
    expect(s.turn).toBe('running')
    expect(s.sessionId).toBe('real-sid')
  })

  it('气泡后面又来了别的 item 也仍然标到那条 user 上', () => {
    let s = addUserItem(initialTranscriptState(), '问题')
    s = transcriptReducer(s, ev('message.delta', { text: '先冒出来一句' }))
    s = transcriptReducer(s, ev('turn.started', { sessionId: 's1', turnId: 't1', mode: 'team' }))
    expect(lastUser(s)?.mode).toBe('team')
  })
})
