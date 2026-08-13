// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionRow } from '../src/renderer/components/Sidebar'
import type { SessionMeta } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/a', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '短标题', turns: 2, ...over,
  }
}

function props(over: Partial<React.ComponentProps<typeof SessionRow>> = {}) {
  return {
    s: meta(), active: false, running: false,
    onSelect: vi.fn(), onToggleStar: vi.fn(), onRename: vi.fn(), onArchive: vi.fn(),
    ...over,
  }
}

afterEach(() => cleanup())

describe('SessionRow 双击改名 + marquee', () => {

  it('1. 双击会话行 → 显示改名输入框', () => {
    render(<SessionRow {...props()} />)
    const row = screen.getByTestId('conversation-item')
    fireEvent.doubleClick(row)
    expect(screen.getByTestId('session-rename-input')).toBeTruthy()
  })

  it('2. 单击铅笔图标仍然能改名(原有路径保留)', () => {
    render(<SessionRow {...props()} />)
    fireEvent.click(screen.getByTestId('session-rename'))
    expect(screen.getByTestId('session-rename-input')).toBeTruthy()
  })

  it('3. 双击改名后 Escape 取消,onRename 不被调用', () => {
    const p = props()
    render(<SessionRow {...p} />)
    fireEvent.doubleClick(screen.getByTestId('conversation-item'))
    const input = screen.getByTestId('session-rename-input')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('session-rename-input')).toBeNull()
    expect(p.onRename).not.toHaveBeenCalled()
  })

  it('4. 双击改名后 Enter 提交,onRename 被调用', () => {
    const p = props({ s: meta({ name: '我的会话' }) })
    render(<SessionRow {...p} />)
    fireEvent.doubleClick(screen.getByTestId('conversation-item'))
    const input = screen.getByTestId('session-rename-input')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onRename).toHaveBeenCalledWith('s1', '我的会话')
  })

  it('5. 非编辑态按钮内含 marquee 结构(wrapper div)', () => {
    render(<SessionRow {...props()} />)
    const btn = screen.getByTestId('conversation-item')
    // 内层 wrapper div(relative overflow-hidden) 应存在
    const wrappers = btn.querySelectorAll('div.relative.overflow-hidden')
    expect(wrappers.length).toBeGreaterThan(0)
  })

  it('6. 短标题 hover 时不渲染第二份文本(无 aria-hidden span)', () => {
    render(<SessionRow {...props({ s: meta({ title: '短' }) })} />)
    const btn = screen.getByTestId('conversation-item')
    fireEvent.mouseEnter(btn)
    // jsdom 无 layout,scrollWidth === clientWidth,isOverflowing 恒为 false
    // 因此第二份文本不应渲染
    const hiddenSpans = btn.querySelectorAll('span[aria-hidden="true"]')
    expect(hiddenSpans.length).toBe(0)
  })

  it('7. 标题按钮使用 overflow-hidden 而非 truncate', () => {
    render(<SessionRow {...props()} />)
    const btn = screen.getByTestId('conversation-item')
    expect(btn.className).toContain('overflow-hidden')
    expect(btn.className).not.toContain('truncate')
  })

  it('8. 编辑态不渲染 marquee 结构', () => {
    render(<SessionRow {...props()} />)
    // 双击进入编辑
    fireEvent.doubleClick(screen.getByTestId('conversation-item'))
    // 编辑态应只包含 input,不含 marquee 的 div 结构
    const input = screen.getByTestId('session-rename-input')
    expect(input).toBeTruthy()
    // 原来的 titleRef div 不应出现在编辑态
    const wrappers = document.querySelectorAll('div.relative.overflow-hidden')
    // 编辑态只有侧边栏其他元素可能有,conversation-item 本身不存在了
    expect(screen.queryByTestId('conversation-item')).toBeNull()
  })

  it('9. 长标题作为 name 参数时,marquee 结构依然正确', () => {
    render(<SessionRow {...props({ s: meta({ name: '这是一个非常非常非常非常非常非常非常非常非常非常长的会话名称用于测试截断效果' }) })} />)
    const btn = screen.getByTestId('conversation-item')
    const wrappers = btn.querySelectorAll('div.relative.overflow-hidden')
    expect(wrappers.length).toBeGreaterThan(0)
    // 文本应该被包裹在 span 中
    const spans = btn.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0].textContent).toContain('这是一个非常')
  })
})
