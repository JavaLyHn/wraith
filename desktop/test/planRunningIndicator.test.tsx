// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PlanChecklist } from '../src/renderer/components/PlanCard'
import { planStatusAnimation, planProgressLabel } from '../src/renderer/lib/planStatus'
import type { PlanStepStatus } from '../src/renderer/lib/planStatus'

/**
 * 「当前这个计划进行的图案不是动态的,不能实时向用户展示正在运行」。
 *
 * PlanCard 的步骤行**一点动画都没有** —— 只是一个静态 ◐ 上了强调色。
 * (TeamCard 有 animate-pulse,计划卡从来没加过;两张卡长得像,行为不一样。)
 *
 * **一个必须记住的坑**:CSS transform 对 inline 元素无效,所以直接给 <span> 加
 * animate-spin 是**没反应**的 —— 必须同时 inline-block。animate-pulse 之所以能用,
 * 是因为它动的是 opacity(inline 元素也吃)。这条不写测试,下次有人"简化"掉 inline-block
 * 时会静默失效:类名还在,动画没了,而 jsdom 里也看不出来。
 */

afterEach(cleanup)

const step = (id: string, status: PlanStepStatus, over: Record<string, unknown> = {}) =>
  ({ id, description: '步骤 ' + id, status, ...over })

const plan = (steps: ReturnType<typeof step>[]) =>
  ({ type: 'plan' as const, planId: 'p1', goal: '分析仓库', steps })

describe('planStatusAnimation', () => {
  it('running 转圈,且带 inline-block —— 少了它 transform 不生效', () => {
    const cls = planStatusAnimation('running')
    expect(cls).toContain('animate-spin')
    expect(cls).toContain('inline-block')
  })

  it('其余三态不动 —— 静止的东西不该假装在跑', () => {
    for (const s of ['pending', 'done', 'failed'] as PlanStepStatus[]) {
      expect(planStatusAnimation(s)).toBe('')
    }
  })
})

describe('planProgressLabel', () => {
  it('有步骤在跑时报「第 n/m 步 · 执行中」', () => {
    expect(planProgressLabel([step('a', 'done'), step('b', 'running'), step('c', 'pending')]))
      .toBe('第 2/3 步 · 执行中')
  })

  it('全做完了报「完成」而不是继续显示执行中', () => {
    expect(planProgressLabel([step('a', 'done'), step('b', 'done')])).toBe('2/2 完成')
  })

  it('有失败时点出来 —— 别用一句「完成」盖过去', () => {
    expect(planProgressLabel([step('a', 'done'), step('b', 'failed')])).toContain('失败')
  })

  it('还没开始(全 pending)不报进度', () => {
    expect(planProgressLabel([step('a', 'pending')])).toBe('')
  })

  it('空计划不报进度', () => {
    expect(planProgressLabel([])).toBe('')
  })

  it('多步并行时按最后一个 running 算 —— 不会报出超过总数的序号', () => {
    const label = planProgressLabel([step('a', 'running'), step('b', 'running'), step('c', 'pending')])
    expect(label).toBe('第 2/3 步 · 执行中')
  })
})

describe('PlanChecklist 渲染', () => {
  it('running 步骤的图标带转圈类', () => {
    const { container } = render(<PlanChecklist item={plan([step('a', 'done'), step('b', 'running')])} />)
    const spinning = container.querySelectorAll('.animate-spin')
    expect(spinning.length).toBe(1)
    expect(spinning[0].className).toContain('inline-block')
  })

  it('没有步骤在跑时一个转圈都没有', () => {
    const { container } = render(<PlanChecklist item={plan([step('a', 'done'), step('b', 'done')])} />)
    expect(container.querySelectorAll('.animate-spin').length).toBe(0)
  })

  it('卡头带实时进度 —— 光看图标数不出来跑到第几步', () => {
    render(<PlanChecklist item={plan([step('a', 'done'), step('b', 'running'), step('c', 'pending')])} />)
    expect(screen.getByTestId('plan-progress').textContent).toContain('第 2/3 步')
  })

  it('running 步骤的流式输出默认展开 —— 折叠着等于看不到它在动', () => {
    render(<PlanChecklist item={plan([step('a', 'running', { output: '正在读文件…' })])} />)
    expect(screen.getByText('正在读文件…')).toBeTruthy()
  })

  it('已完成步骤的输出仍然默认折叠 —— 免得整卡被历史正文撑爆', () => {
    render(<PlanChecklist item={plan([step('a', 'done', { result: '这是很长的结果' })])} />)
    expect(screen.queryByText('这是很长的结果')).toBeNull()
  })

  it('流式框带 [overflow-anchor:none] 与自动贴底(与 TeamCard 同一套)', () => {
    const { container } = render(<PlanChecklist item={plan([step('a', 'running', { output: 'x'.repeat(3000) })])} />)
    expect(container.querySelectorAll('[class*="overflow-anchor"]').length).toBeGreaterThan(0)
  })
})
