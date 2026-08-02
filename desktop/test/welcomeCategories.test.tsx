// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import WelcomeEmptyState from '../src/renderer/components/WelcomeEmptyState'
import type { PromptCategory } from '../src/renderer/lib/welcomePrompts'

afterEach(cleanup)

const CATS: PromptCategory[] = [
  { label: '了解这个项目', prompts: ['梳理这个目录的结构', '这个项目是做什么的'] },
  { label: '改进代码', prompts: ['审查我最近这次改动', '找出最该补测试的地方'] },
]

function renderWelcome(over: Partial<React.ComponentProps<typeof WelcomeEmptyState>> = {}) {
  const onPickExample = vi.fn()
  render(
    <WelcomeEmptyState categories={CATS} onPickExample={onPickExample} {...over}>
      <div data-testid="composer">composer</div>
    </WelcomeEmptyState>,
  )
  return { onPickExample }
}

/**
 * 首页示例从"一排半句"改成两级(类别 → 具体建议)。这组用例守两件事:
 * 第一级不能直接发出去(那等于把类别名当指令),第二级点了必须给出完整可跑的句子。
 */
describe('首页示例:两级选择', () => {
  it('初始只显示类别,不显示具体建议', () => {
    renderWelcome()
    expect(screen.getAllByTestId('welcome-category')).toHaveLength(2)
    expect(screen.queryByTestId('welcome-example')).toBeNull()
  })

  it('点类别 → 展开该类别的建议,类别芯片让位', () => {
    renderWelcome()
    fireEvent.click(screen.getByText('改进代码'))
    const leaves = screen.getAllByTestId('welcome-example').map((b) => b.textContent)
    expect(leaves).toEqual(['审查我最近这次改动', '找出最该补测试的地方'])
    expect(screen.queryByTestId('welcome-category')).toBeNull()
  })

  it('点类别本身不会把类别名当指令发出去', () => {
    // 一级芯片是导航不是指令;误发的话用户会收到一句「改进代码」这种没头没尾的输入
    const { onPickExample } = renderWelcome()
    fireEvent.click(screen.getByText('改进代码'))
    expect(onPickExample).not.toHaveBeenCalled()
  })

  it('点具体建议 → 回传完整句子', () => {
    const { onPickExample } = renderWelcome()
    fireEvent.click(screen.getByText('改进代码'))
    fireEvent.click(screen.getByText('审查我最近这次改动'))
    expect(onPickExample).toHaveBeenCalledWith('审查我最近这次改动')
  })

  it('能返回上一级重选', () => {
    renderWelcome()
    fireEvent.click(screen.getByText('改进代码'))
    fireEvent.click(screen.getByTestId('welcome-back'))
    expect(screen.getAllByTestId('welcome-category')).toHaveLength(2)
    expect(screen.queryByTestId('welcome-example')).toBeNull()
  })

  it('展开状态下 composer 仍在(选建议不该挡住直接打字)', () => {
    renderWelcome()
    fireEvent.click(screen.getByText('了解这个项目'))
    expect(screen.getByTestId('composer')).toBeTruthy()
  })

  it('没有类别时整块不渲染', () => {
    renderWelcome({ categories: [] })
    expect(screen.queryByTestId('welcome-category')).toBeNull()
    expect(screen.getByTestId('composer')).toBeTruthy()
  })
})
