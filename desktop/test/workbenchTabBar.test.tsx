// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import WorkbenchTabBar from '../src/renderer/components/WorkbenchTabBar'
import type { PreviewKind } from '../src/shared/types'

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
