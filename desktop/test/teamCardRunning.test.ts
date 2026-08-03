import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState } from '../src/shared/transcriptReducer'
import type { TeamStep } from '../src/shared/transcriptReducer'
import { stepPhaseLabel, reviewerDotClass, showsReviewerBlock } from '../src/renderer/lib/teamCardStatus'
import { shouldStickToBottom } from '../src/renderer/lib/stickToBottom'

/**
 * 「reviewer 明明在跑,界面上一点动静都没有,用户以为死机了」。
 *
 * 根因是两件事叠在一起:
 * A. reviewer 在 UI 里**没有自己的状态**。它唯一的信号是流式正文增量,所以审查块要等
 *    第一个 token 才出现;思考型模型出第一个 token 前可能沉默几十秒。表头那个 reviewer
 *    圆点跟的是「任意步骤在跑」,与 reviewer 无关 —— worker 在跑它也闪。
 * B. 流式输出框是 max-h-48 overflow-y-auto 且**不自动贴底**。内容一旦超过这个高度,
 *    可见区就冻在最前面几行,后面几千字全长在视野外;因为框有高度上限,外层 Transcript
 *    的自动贴底也没得可滚 —— 整张卡片彻底静止。
 */

const ev = (method: string, params: unknown) => ({ kind: 'notification' as const, method, params })
const run = (events: { method: string; params: unknown }[]) =>
  events.reduce((s, e) => transcriptReducer(s, e), initialTranscriptState())

const step = (over: Partial<TeamStep> = {}): TeamStep => ({
  id: 'step_1', description: 'D', type: 'X', status: 'running', ...over,
})

describe('A. reviewer 的实时状态', () => {
  it('team.review.started 把该步标成审查中', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }] }),
      ev('team.step.started', { teamId: 't1', stepId: 'step_1', agent: 'worker-1' }),
      ev('team.review.started', { teamId: 't1', stepId: 'step_1' }),
    ])
    const item = s.items.find(i => i.type === 'team') as { steps: TeamStep[] }
    expect(item.steps[0].reviewStatus).toBe('running')
    expect(item.steps[0].status).toBe('running')   // 审查期间步骤仍在跑
  })

  it('team.review.completed 把它收掉', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }] }),
      ev('team.review.started', { teamId: 't1', stepId: 'step_1' }),
      ev('team.review.completed', { teamId: 't1', stepId: 'step_1', approved: true }),
    ])
    const item = s.items.find(i => i.type === 'team') as { steps: TeamStep[] }
    expect(item.steps[0].reviewStatus).toBe('done')
  })

  it('重试:第二轮 review.started 让它重新变回审查中', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }] }),
      ev('team.review.started', { teamId: 't1', stepId: 'step_1' }),
      ev('team.review.completed', { teamId: 't1', stepId: 'step_1', approved: false }),
      ev('team.review.started', { teamId: 't1', stepId: 'step_1' }),
    ])
    const item = s.items.find(i => i.type === 'team') as { steps: TeamStep[] }
    expect(item.steps[0].reviewStatus).toBe('running')
  })

  it('兜底:review.completed 丢了也不能永远停在「审查中」—— 步骤结算即收掉', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }] }),
      ev('team.review.started', { teamId: 't1', stepId: 'step_1' }),
      // 没有 review.completed,直接来 step.completed
      ev('team.step.completed', { teamId: 't1', stepId: 'step_1', status: 'completed', result: 'R', approved: true, retries: 0 }),
    ])
    const item = s.items.find(i => i.type === 'team') as { steps: TeamStep[] }
    expect(item.steps[0].reviewStatus).toBe('done')
  })

  it('老后端不发这两个事件时行为不变(reviewStatus 保持 undefined)', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }] }),
      ev('team.step.started', { teamId: 't1', stepId: 'step_1', agent: 'worker-1' }),
      ev('team.review.output', { teamId: 't1', stepId: 'step_1', text: '{"approved"' }),
    ])
    const item = s.items.find(i => i.type === 'team') as { steps: TeamStep[] }
    expect(item.steps[0].reviewStatus).toBeUndefined()
    expect(item.steps[0].reviewOutput).toBe('{"approved"')
  })
})

describe('A. 阶段文字:说清此刻是谁在干活', () => {
  it('worker 执行中', () => {
    expect(stepPhaseLabel(step({ status: 'running' }))).toContain('执行中')
  })

  it('reviewer 审查中 —— 同一个 running 步骤,阶段不同', () => {
    const label = stepPhaseLabel(step({ status: 'running', reviewStatus: 'running' }))
    expect(label).toContain('审查中')
    expect(label).not.toContain('执行中')
  })

  it('审完了但步骤还没结算:仍算执行中(worker 在按反馈重跑)', () => {
    expect(stepPhaseLabel(step({ status: 'running', reviewStatus: 'done' }))).toContain('执行中')
  })

  it('步骤结束后不再显示阶段文字', () => {
    expect(stepPhaseLabel(step({ status: 'done', reviewStatus: 'done' }))).toBeNull()
    expect(stepPhaseLabel(step({ status: 'pending' }))).toBeNull()
    expect(stepPhaseLabel(step({ status: 'failed' }))).toBeNull()
  })
})

describe('A. 表头 reviewer 圆点只在 reviewer 真的在跑时闪', () => {
  it('worker 在跑、reviewer 没跑 → 不闪(这是原来那个说谎的点)', () => {
    const dot = reviewerDotClass([step({ status: 'running' })])
    expect(dot).not.toContain('animate-pulse')
  })

  it('reviewer 在跑 → 闪', () => {
    expect(reviewerDotClass([step({ status: 'running', reviewStatus: 'running' })])).toContain('animate-pulse')
  })

  it('多步里只要有一步在审查就闪', () => {
    const dot = reviewerDotClass([
      step({ id: 'a', status: 'done' }),
      step({ id: 'b', status: 'running', reviewStatus: 'running' }),
    ])
    expect(dot).toContain('animate-pulse')
  })
})

describe('A. 审查块在第一个 token 之前就要出现', () => {
  it('审查中但还没吐字 → 也显示(否则那几十秒里什么都没有)', () => {
    expect(showsReviewerBlock(step({ status: 'running', reviewStatus: 'running' }))).toBe(true)
  })

  it('有输出就显示,不论状态', () => {
    expect(showsReviewerBlock(step({ status: 'done', reviewOutput: '{...}' }))).toBe(true)
  })

  it('既没状态也没输出 → 不显示,别挂个空框', () => {
    expect(showsReviewerBlock(step({ status: 'running' }))).toBe(false)
  })
})

describe('B. 流式框自动贴底的判定', () => {
  it('已经在底部 → 继续跟随', () => {
    expect(shouldStickToBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
  })

  it('用户往上翻了 → 不再抢他的滚动位置', () => {
    expect(shouldStickToBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 })).toBe(false)
  })

  it('差一点点(浏览器亚像素/滚动惯性)仍算贴底', () => {
    expect(shouldStickToBottom({ scrollTop: 880, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
  })

  it('内容还没满一屏 → 算贴底(此时根本没有滚动条)', () => {
    expect(shouldStickToBottom({ scrollTop: 0, scrollHeight: 50, clientHeight: 192 })).toBe(true)
  })
})
