/**
 * TDD tests for transcriptReducer — plan.* 事件 → 计划清单 / 复审 item。
 *
 * Run: cd desktop && npx vitest run test/transcriptReducerPlan.test.ts
 */

import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState, markPlanReviewResolved } from '../src/shared/transcriptReducer'
import type { PlanItem, PlanReviewItem } from '../src/shared/transcriptReducer'

// ---------------------------------------------------------------------------
// 辅助：从 state 里取出 plan item
// ---------------------------------------------------------------------------

function planItem(s: ReturnType<typeof initialTranscriptState>): PlanItem {
  const item = s.items.find(i => i.type === 'plan')
  if (!item) throw new Error('no plan item')
  return item as PlanItem
}

function planReviewItem(s: ReturnType<typeof initialTranscriptState>): PlanReviewItem {
  const item = s.items.find(i => i.type === 'planReview')
  if (!item) throw new Error('no planReview item')
  return item as PlanReviewItem
}

function planStep(s: ReturnType<typeof initialTranscriptState>, id: string) {
  return planItem(s).steps.find(st => st.id === id)!
}

// ---------------------------------------------------------------------------
// Test 1: plan.created 建 plan item，步骤初始 pending
// ---------------------------------------------------------------------------
describe('plan.created', () => {
  it('建 plan item，steps 初始全为 pending', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created',
      planId: 'p1',
      goal: '目标',
      steps: [
        { id: 't1', description: '步骤一', deps: [] },
        { id: 't2', description: '步骤二', deps: ['t1'] },
      ],
    } as never)
    const item = planItem(s)
    expect(item.planId).toBe('p1')
    expect(item.goal).toBe('目标')
    expect(item.steps).toHaveLength(2)
    expect(item.steps[0]).toMatchObject({ id: 't1', description: '步骤一', status: 'pending' })
    expect(item.steps[1]).toMatchObject({ id: 't2', description: '步骤二', status: 'pending' })
  })
})

// ---------------------------------------------------------------------------
// Test 2: step.started → running，step.completed(ok:true) → done，(ok:false) → failed
// ---------------------------------------------------------------------------
describe('plan step lifecycle', () => {
  it('step.started → running', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    s = transcriptReducer(s, { type: 'plan.step.started', planId: 'p1', stepId: 't1' } as never)
    expect(planStep(s, 't1').status).toBe('running')
  })

  it('step.completed(ok:true) → done，result 已存', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    s = transcriptReducer(s, { type: 'plan.step.started', planId: 'p1', stepId: 't1' } as never)
    s = transcriptReducer(s, { type: 'plan.step.completed', planId: 'p1', stepId: 't1', ok: true, result: 'output' } as never)
    expect(planStep(s, 't1').status).toBe('done')
    expect(planStep(s, 't1').result).toBe('output')
  })

  it('step.completed(ok:false) → failed，result 已存', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    s = transcriptReducer(s, { type: 'plan.step.started', planId: 'p1', stepId: 't1' } as never)
    s = transcriptReducer(s, { type: 'plan.step.completed', planId: 'p1', stepId: 't1', ok: false, result: 'err' } as never)
    expect(planStep(s, 't1').status).toBe('failed')
    expect(planStep(s, 't1').result).toBe('err')
  })
})

// ---------------------------------------------------------------------------
// Test 3: plan.review.requested 追加 planReview item，resolved:false
// ---------------------------------------------------------------------------
describe('plan.review.requested', () => {
  it('追加 planReview item，resolved 初始 false', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    s = transcriptReducer(s, {
      type: 'plan.review.requested',
      reviewId: 'rv1', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    const review = planReviewItem(s)
    expect(review.reviewId).toBe('rv1')
    expect(review.planId).toBe('p1')
    expect(review.resolved).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 4: 幂等 — 同一 planId 两次 plan.created → 仅一个 plan item，后者步骤覆盖前者
// ---------------------------------------------------------------------------
describe('plan.created 幂等', () => {
  it('两次 plan.created 同 planId → items 里仅一个 plan item，steps 反映第二次', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: '目标 v1',
      steps: [{ id: 'a', description: '旧步骤', deps: [] }],
    } as never)
    s = transcriptReducer(s, {
      type: 'plan.created', planId: 'p1', goal: '目标 v2',
      steps: [
        { id: 'b', description: '新步骤一', deps: [] },
        { id: 'c', description: '新步骤二', deps: ['b'] },
      ],
    } as never)
    const planItems = s.items.filter(i => i.type === 'plan')
    expect(planItems).toHaveLength(1)
    const item = planItems[0] as PlanItem
    expect(item.goal).toBe('目标 v2')
    expect(item.steps.map(st => st.id)).toEqual(['b', 'c'])
    expect(item.steps.every(st => st.status === 'pending')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 5-new: plan.step.output — 累积到正确步骤的 output 字段
// ---------------------------------------------------------------------------
describe('plan.step.output', () => {
  it('delta 追加到匹配步骤的 output，累积两次', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: '目标',
      steps: [
        { id: 't1', description: '步骤一', deps: [] },
        { id: 't2', description: '步骤二', deps: ['t1'] },
      ],
    } as never)
    s = transcriptReducer(s, { type: 'plan.step.output', planId: 'p1', stepId: 't1', text: '片段A' } as never)
    s = transcriptReducer(s, { type: 'plan.step.output', planId: 'p1', stepId: 't1', text: '片段B' } as never)
    expect(planStep(s, 't1').output).toBe('片段A片段B')
    // t2 不受影响
    expect(planStep(s, 't2').output).toBeUndefined()
  })

  it('不同 stepId 各自累积，不相互污染', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: '目标',
      steps: [
        { id: 't1', description: '步骤一', deps: [] },
        { id: 't2', description: '步骤二', deps: ['t1'] },
      ],
    } as never)
    s = transcriptReducer(s, { type: 'plan.step.output', planId: 'p1', stepId: 't1', text: 'X' } as never)
    s = transcriptReducer(s, { type: 'plan.step.output', planId: 'p1', stepId: 't2', text: 'Y' } as never)
    expect(planStep(s, 't1').output).toBe('X')
    expect(planStep(s, 't2').output).toBe('Y')
  })
})

// ---------------------------------------------------------------------------
// Test 5: markPlanReviewResolved — 翻 resolved:true
// ---------------------------------------------------------------------------
describe('markPlanReviewResolved', () => {
  it('resolved 从 false 翻为 true', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.review.requested',
      reviewId: 'rv1', planId: 'p1', goal: 'g',
      steps: [],
    } as never)
    s = markPlanReviewResolved(s, 'rv1')
    expect(planReviewItem(s).resolved).toBe(true)
  })

  it('markPlanReviewResolved 不影响其他 item', () => {
    let s = transcriptReducer(initialTranscriptState(), {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    s = transcriptReducer(s, {
      type: 'plan.review.requested',
      reviewId: 'rv1', planId: 'p1', goal: 'g',
      steps: [],
    } as never)
    s = markPlanReviewResolved(s, 'rv1')
    // plan item 未被破坏
    expect(planItem(s).planId).toBe('p1')
  })
})

// ---------------------------------------------------------------------------
// plan.output: 规划器"生成计划"阶段的流式正文(plan.created 前的空窗填充)
// ---------------------------------------------------------------------------
describe('plan.output (规划器生成阶段流式)', () => {
  it('plan.created 前即创建 plan item 并累积 plannerOutput，steps 为空', () => {
    let s = transcriptReducer(initialTranscriptState(), { type: 'plan.output', planId: 'p1', text: '规划中' } as never)
    s = transcriptReducer(s, { type: 'plan.output', planId: 'p1', text: '：读+验' } as never)
    const item = planItem(s)
    expect(item.plannerOutput).toBe('规划中：读+验')
    expect(item.steps).toHaveLength(0)
  })

  it('随后 plan.created 填入 steps 且保留 plannerOutput，不重复创建 plan item', () => {
    let s = transcriptReducer(initialTranscriptState(), { type: 'plan.output', planId: 'p1', text: 'gen' } as never)
    s = transcriptReducer(s, {
      type: 'plan.created', planId: 'p1', goal: 'g',
      steps: [{ id: 't1', description: 'a', deps: [] }],
    } as never)
    const item = planItem(s)
    expect(item.steps).toHaveLength(1)
    expect(item.plannerOutput).toBe('gen')
    expect(s.items.filter(i => i.type === 'plan')).toHaveLength(1)
  })
})
