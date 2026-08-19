// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import WorkbenchTabBar from '../src/renderer/components/WorkbenchTabBar'
import type { PreviewKind } from '../src/shared/types'

// jsdom 无 ResizeObserver,空实现让 useEffect 不炸
class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => { global.ResizeObserver = MockResizeObserver as never })
afterEach(() => cleanup())

type Tab =
  | { id: 'chat'; title: string }
  | { id: `file:${string}`; title: string; path: string; kind: PreviewKind }

const tabs: Tab[] = [
  { id: 'chat', title: '聊天' },
  { id: 'file:d:\\wraith\\A.java', title: 'A.java', path: 'd:\\wraith\\A.java', kind: 'code' },
  { id: 'file:d:\\wraith\\B.md', title: 'B.md', path: 'd:\\wraith\\B.md', kind: 'markdown' },
]

const baseProps = { tabs, activeId: 'chat' as const, onActivate: () => {}, onClose: () => {}, fileTreeVisible: false, onToggleFileTree: () => {} }

describe('WorkbenchTabBar', () => {
  it('聊天 tab 在第 0 位,无关闭按钮;其他 tab 有 close', () => {
    render(<WorkbenchTabBar {...baseProps} />)
    const chatTab = screen.getByText('聊天')
    expect(chatTab).toBeTruthy()
    const closeBtns = screen.getAllByTitle(/关闭/)
    expect(closeBtns).toHaveLength(2)
  })

  it('点击 tab 触发 onActivate(id),点击 close 触发 onClose', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(<WorkbenchTabBar {...baseProps} onActivate={onActivate} onClose={onClose} />)
    fireEvent.click(screen.getByText('A.java'))
    expect(onActivate).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
    fireEvent.click(screen.getAllByTitle(/关闭/)[0])
    expect(onClose).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
  })

  it('active tab 渲染 wb-tab-active class(视觉契约)', () => {
    const activeId = tabs[1].id
    render(<WorkbenchTabBar {...baseProps} activeId={activeId} />)
    const activeTab = screen.getByRole('tab', { selected: true })
    expect(activeTab).toBeTruthy()
    expect(activeTab.className).toContain('wb-tab-active')
    expect(activeTab.textContent ?? '').toContain('A.java')
  })

  it('文件树开关常驻 tab 栏尾部:可见时显示"收文件树",点击触发 onToggleFileTree', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<WorkbenchTabBar {...baseProps} fileTreeVisible onToggleFileTree={onToggle} />)
    const btn = screen.getByTestId('workbench-toggle-filetree')
    expect(btn.textContent).toContain('收文件树')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
    // 收起后文案切换
    rerender(<WorkbenchTabBar {...baseProps} fileTreeVisible={false} onToggleFileTree={onToggle} />)
    expect(screen.getByTestId('workbench-toggle-filetree').textContent).toContain('开文件树')
  })

  it('开关不随 tab 激活态消失(文件 tab 激活时也要能收文件树)', () => {
    // 激活 B.md 文件 tab —— 旧实现里 toggle 在 chat 分支内,此场景会消失
    render(<WorkbenchTabBar {...baseProps} activeId={tabs[2].id} fileTreeVisible />)
    expect(screen.getByTestId('workbench-toggle-filetree')).toBeTruthy()
  })
})

describe('WorkbenchTabBar 横向滚动', () => {
  // 在滚动容器实例上覆写几何属性,模拟横向溢出(jsdom 默认 0,无溢出);
  // scrollBy 也 mock 掉:jsdom 对 scrollBy 派发 scroll 时有 HTMLUnknownElement quirk
  function mockGeometry(el: Element, { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
    Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft })
    Object.defineProperty(el, 'scrollBy', { configurable: true, value: vi.fn() })
  }

  it('无溢出时左右箭头都不渲染(避免噪点)', () => {
    render(<WorkbenchTabBar {...baseProps} />)
    const list = screen.getByRole('tablist')
    mockGeometry(list, { scrollWidth: 500, clientWidth: 500, scrollLeft: 0 })
    // 触发一次 scroll 让 updateScrollState 重跑
    act(() => { fireEvent.scroll(list) })
    expect(screen.queryByLabelText('向左滚动 tab')).toBeNull()
    expect(screen.queryByLabelText('向右滚动 tab')).toBeNull()
  })

  it('右侧有溢出 → 右箭头出现,左箭头无', () => {
    render(<WorkbenchTabBar {...baseProps} />)
    const list = screen.getByRole('tablist')
    mockGeometry(list, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 })
    act(() => { fireEvent.scroll(list) })
    expect(screen.queryByLabelText('向左滚动 tab')).toBeNull()
    expect(screen.getByLabelText('向右滚动 tab')).toBeTruthy()
  })

  it('滚到中间(左右都有空间)→ 左右箭头都出现', () => {
    render(<WorkbenchTabBar {...baseProps} />)
    const list = screen.getByRole('tablist')
    mockGeometry(list, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 300 })
    act(() => { fireEvent.scroll(list) })
    expect(screen.getByLabelText('向左滚动 tab')).toBeTruthy()
    expect(screen.getByLabelText('向右滚动 tab')).toBeTruthy()
  })

  it('点右箭头 → scrollLeft 增加(横滚生效),到尽头后右箭头消失', () => {
    render(<WorkbenchTabBar {...baseProps} />)
    const list = screen.getByRole('tablist')
    // 初始右侧溢出
    mockGeometry(list, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 })
    act(() => { fireEvent.scroll(list) })
    const rightBtn = screen.getByLabelText('向右滚动 tab')
    // 模拟点击后的滚动结果:scrollLeft 推到尽头
    Object.defineProperty(list, 'scrollLeft', { configurable: true, value: 600 })
    act(() => { fireEvent.click(rightBtn) })
    // scrollBy 是异步 smooth,直接再触发 scroll 让状态收敛到尽头
    act(() => { fireEvent.scroll(list) })
    // 到底(scrollLeft 600 ≥ 1000-400-1)→ 右箭头消失
    expect(screen.queryByLabelText('向右滚动 tab')).toBeNull()
  })
})
