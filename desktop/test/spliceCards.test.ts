import { describe, it, expect } from 'vitest'
import { spliceCards } from '../src/shared/spliceCards'
import type { Item } from '../src/shared/transcriptReducer'

const base: Item[] = [
  { type: 'user', text: '你好' },
  { type: 'message', text: '答' },
]

/**
 * team.* 事件序列：
 * team.started → team.plan → team.step.started → team.step.output →
 * team.step.completed → team.review.output → team.finished
 *
 * 关键对齐（按 transcriptReducer case 核对）：
 * - team.started: { teamId, goal, agents:[] }
 * - team.plan: { teamId, steps:[{id, description, type}] }  ← type 字段必须存在
 * - team.step.started: { teamId, stepId, agent }
 * - team.step.output: { teamId, stepId, text }
 * - team.step.completed: { teamId, stepId, status:'done', result, approved, retries }
 * - team.review.output: { teamId, stepId, text }
 * - team.finished: { teamId, status:'completed' }
 */
const teamEvents = [
  { method: 'team.started', params: { teamId: 't1', goal: '你好', agents: [] } },
  { method: 'team.plan', params: { teamId: 't1', steps: [{ id: 's1', description: '回复问候', type: 'task' }] } },
  { method: 'team.step.started', params: { teamId: 't1', stepId: 's1', agent: 'worker-1' } },
  { method: 'team.step.output', params: { teamId: 't1', stepId: 's1', text: '你好！' } },
  { method: 'team.step.completed', params: { teamId: 't1', stepId: 's1', status: 'done', result: '你好！我是 Wraith', approved: true, retries: 0 } },
  { method: 'team.review.output', params: { teamId: 't1', stepId: 's1', text: '审查通过理由…' } },
  { method: 'team.finished', params: { teamId: 't1', status: 'completed' } },
]

/**
 * plan.* 事件序列：
 * plan.created → plan.step.started → plan.step.output → plan.step.completed
 *
 * 关键对齐（按 transcriptReducer case 核对）：
 * - plan.created: { planId, goal, steps:[{id, description}] }
 * - plan.step.started: { planId, stepId }
 * - plan.step.output: { planId, stepId, text }
 * - plan.step.completed: { planId, stepId, ok:boolean, result? }
 */
const planEvents = [
  { method: 'plan.created', params: { planId: 'p1', goal: '分析需求', steps: [{ id: 'ps1', description: '分析用户需求' }] } },
  { method: 'plan.step.started', params: { planId: 'p1', stepId: 'ps1' } },
  { method: 'plan.step.output', params: { planId: 'p1', stepId: 'ps1', text: '正在分析…' } },
  { method: 'plan.step.completed', params: { planId: 'p1', stepId: 'ps1', ok: true, result: '需求分析完成' } },
]

describe('spliceCards', () => {
  it('将 team card 插入 user 之后、message 之前（turnOrdinal:0）', () => {
    const out = spliceCards(base, [{ turnOrdinal: 0, events: teamEvents }])
    expect(out.map(i => i.type)).toEqual(['user', 'team', 'message'])
    const team = out[1] as any
    expect(team.steps[0].result).toContain('Wraith')
    expect(team.steps[0].reviewOutput).toContain('审查通过')
  })

  it('将 plan card 插入 user 之后、message 之前（turnOrdinal:0）', () => {
    const out = spliceCards(base, [{ turnOrdinal: 0, events: planEvents }])
    expect(out.map(i => i.type)).toEqual(['user', 'plan', 'message'])
    const plan = out[1] as any
    expect(plan.steps[0].result).toBe('需求分析完成')
    expect(plan.steps[0].status).toBe('done')
  })

  it('无 cards 时原样返回', () => {
    expect(spliceCards(base)).toBe(base)
    expect(spliceCards(base, [])).toBe(base)
  })

  it('turnOrdinal 越界时跳过（不插入）', () => {
    const out = spliceCards(base, [{ turnOrdinal: 99, events: teamEvents }])
    expect(out).toEqual(base)
  })

  it('多卡片（ordinal 1 和 0）各自落在正确位置', () => {
    // baseItems: [user0, msg0, user1, msg1]
    const multiBase: Item[] = [
      { type: 'user', text: '第一条' },
      { type: 'message', text: '答一' },
      { type: 'user', text: '第二条' },
      { type: 'message', text: '答二' },
    ]
    const out = spliceCards(multiBase, [
      { turnOrdinal: 1, events: teamEvents },
      { turnOrdinal: 0, events: planEvents },
    ])
    // 期望: user0 → plan → msg0 → user1 → team → msg1
    expect(out.map(i => i.type)).toEqual(['user', 'plan', 'message', 'user', 'team', 'message'])
  })

  it('replay 无效事件时跳过（不插入空项）', () => {
    const badEvents = [{ method: 'unknown.event', params: {} }]
    const out = spliceCards(base, [{ turnOrdinal: 0, events: badEvents }])
    expect(out).toEqual(base)
  })
})
