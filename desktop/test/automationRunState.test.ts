import { describe, it, expect } from 'vitest'
import { initialRunState, applyRunEvent, summaryOf, type RunEvent } from '../src/main/automationRunState'

const n = (method: string, params: Record<string, unknown> = {}): RunEvent =>
  ({ type: 'notification', method, params })

function play(events: RunEvent[]) {
  return events.reduce(applyRunEvent, initialRunState())
}

describe('applyRunEvent', () => {
  it('正常完成:delta 聚合→end 定稿→completed 带 sessionId', () => {
    const s = play([
      { type: 'turn-submitted' },
      n('message.delta', { text: '你好,' }), n('message.delta', { text: '世界' }),
      n('message.end'),
      n('turn.completed', { sessionId: 'sess_9' }),
    ])
    expect(s.phase).toBe('success')
    expect(s.sessionId).toBe('sess_9')
    expect(summaryOf(s)).toBe('你好,世界')
  })

  it('多条消息取最后一条定稿的', () => {
    const s = play([
      { type: 'turn-submitted' },
      n('message.delta', { text: '第一段' }), n('message.end'),
      n('message.delta', { text: '最终结论' }), n('message.end'),
      n('turn.completed', { sessionId: 'x' }),
    ])
    expect(summaryOf(s)).toBe('最终结论')
  })

  it('审批挂起与恢复', () => {
    const mid = play([
      { type: 'turn-submitted' },
      n('approval.requested', { approvalId: 'ap1', toolName: 'execute_command' }),
    ])
    expect(mid.phase).toBe('waiting_approval')
    expect(mid.approval?.approvalId).toBe('ap1')
    const resumed = applyRunEvent(mid, { type: 'approval-responded' })
    expect(resumed.phase).toBe('running')
    expect(resumed.approval).toBeNull()
  })

  it('turn.failed / child-exit / stopped 各归其态;终态幂等', () => {
    // 各态转移与 error 字段验证
    const failedByTurn = play([{ type: 'turn-submitted' }, n('turn.failed', { error: 'boom' })])
    expect(failedByTurn.phase).toBe('failed')
    expect(failedByTurn.error).toBe('boom')

    const failedByChildExit = play([{ type: 'turn-submitted' }, { type: 'child-exit' }])
    expect(failedByChildExit.phase).toBe('failed')
    expect(failedByChildExit.error).toBe('子进程意外退出')

    const interrupted = play([{ type: 'turn-submitted' }, { type: 'stopped' }])
    expect(interrupted.phase).toBe('interrupted')

    // 终态幂等:failed 态不再变化
    const failedAgain = applyRunEvent(failedByTurn, n('message.delta', { text: 'ignored' }))
    expect(failedAgain).toBe(failedByTurn) // 返回原对象
    expect(failedAgain.phase).toBe('failed')

    const failedChildExit = applyRunEvent(failedByTurn, { type: 'child-exit' })
    expect(failedChildExit).toBe(failedByTurn)
    expect(failedChildExit.phase).toBe('failed')

    // 终态幂等:interrupted 态不再变化
    const interruptedAgain = applyRunEvent(interrupted, n('message.delta', { text: 'ignored' }))
    expect(interruptedAgain).toBe(interrupted)
    expect(interruptedAgain.phase).toBe('interrupted')

    const interruptedChildExit = applyRunEvent(interrupted, { type: 'child-exit' })
    expect(interruptedChildExit).toBe(interrupted)
    expect(interruptedChildExit.phase).toBe('interrupted')

    // 终态幂等:success 态不再变化
    const done = play([{ type: 'turn-submitted' }, n('turn.completed', { sessionId: 'x' })])
    expect(done.phase).toBe('success')

    const doneAgain = applyRunEvent(done, { type: 'child-exit' })
    expect(doneAgain).toBe(done)
    expect(doneAgain.phase).toBe('success')
  })

  it('summaryOf:未定稿用 buf;截 120 字并单行化', () => {
    const s = play([{ type: 'turn-submitted' }, n('message.delta', { text: 'A\nB'.padEnd(200, 'x') })])
    expect(summaryOf(s).length).toBe(120)
    expect(summaryOf(s)).not.toContain('\n')
  })
})
