// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TeamCard } from '../src/renderer/components/TeamCard'
import type { TeamItem, TeamStep } from '../src/shared/transcriptReducer'

/**
 * 用户截图里的那个状态:reviewer 正在审查,界面上一点动静都没有,以为死机了。
 *
 * 这里渲染的就是那一刻的 item 形态,断言「看得出它在动」。
 */

const step = (over: Partial<TeamStep> = {}): TeamStep => ({
  id: 'step_1', description: '回顾对话上下文中用户的所有消息', type: 'ANALYSIS',
  agent: 'worker-1', status: 'running', ...over,
})

const item = (steps: TeamStep[]): TeamItem => ({
  type: 'team', teamId: 't1', goal: '分析当前会话',
  agents: [
    { id: 'planner', role: 'planner' },
    { id: 'worker-1', role: 'worker' },
    { id: 'reviewer', role: 'reviewer' },
  ],
  steps, parallelStepIds: [],
})

// 这个仓库的 vitest 没开 globals,@testing-library 的自动 cleanup 不生效 ——
// 不显式清,上一条测试的 DOM 会留下,screen 查询报「Found multiple elements」。
afterEach(cleanup)

describe('reviewer 在跑时看得出来', () => {
  it('审查中但还没吐第一个字:审查块就要出现,并写着「审查中…」', () => {
    render(<TeamCard item={item([step({ reviewStatus: 'running' })])} />)

    expect(screen.getByTestId('team-review-block')).toBeTruthy()
    expect(screen.getByTestId('team-review-running').textContent).toContain('审查中')
  })

  it('审查中时步骤行的阶段文字是「审查中」而不是「执行中」', () => {
    render(<TeamCard item={item([step({ reviewStatus: 'running', output: 'worker 的结果' })])} />)
    expect(screen.getByTestId('team-step-phase').textContent).toContain('审查中')
  })

  it('worker 在跑时阶段文字是「执行中」', () => {
    render(<TeamCard item={item([step({ output: '正在写…' })])} />)
    expect(screen.getByTestId('team-step-phase').textContent).toContain('执行中')
  })

  it('「审查中」带脉冲动画 —— 静止的文字仍然像死机', () => {
    render(<TeamCard item={item([step({ reviewStatus: 'running' })])} />)
    expect(screen.getByTestId('team-review-running').className).toContain('animate-pulse')
    expect(screen.getByTestId('team-step-phase').className).toContain('animate-pulse')
  })

  it('审查完了:不再显示「审查中…」', () => {
    render(<TeamCard item={item([step({
      status: 'done', reviewStatus: 'done', reviewOutput: '{"approved":true}', result: 'R',
    })])} />)
    expect(screen.queryByTestId('team-review-running')).toBeNull()
    expect(screen.queryByTestId('team-step-phase')).toBeNull()
  })

  it('审查中还没吐字时不挂折叠箭头(没内容可折)', () => {
    const { container } = render(<TeamCard item={item([step({ reviewStatus: 'running' })])} />)
    expect(container.querySelector('[aria-label="折叠审查输出"]')).toBeNull()
    expect(container.querySelector('[aria-label="展开审查输出"]')).toBeNull()
  })

  it('老后端(不发 review.started)行为不变:有输出才出现审查块', () => {
    render(<TeamCard item={item([step({ reviewOutput: '{"approved"' })])} />)
    expect(screen.getByTestId('team-review-block')).toBeTruthy()
    expect(screen.queryByTestId('team-review-running')).toBeNull()
  })

  it('完全没有审查信号时不挂空框', () => {
    render(<TeamCard item={item([step({ status: 'pending' })])} />)
    expect(screen.queryByTestId('team-review-block')).toBeNull()
  })

  it('流式框带 [overflow-anchor:none] —— 否则浏览器会在内容增长时反向补偿 scrollTop', () => {
    const { container } = render(<TeamCard item={item([step({ output: 'x'.repeat(4000) })])} />)
    const boxes = container.querySelectorAll('[class*="overflow-anchor"]')
    expect(boxes.length).toBeGreaterThan(0)
  })
})
