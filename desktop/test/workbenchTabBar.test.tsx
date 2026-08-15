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

describe('WorkbenchTabBar', () => {
  it('聊天 tab 在第 0 位,无关闭按钮;其他 tab 有 close', () => {
    render(<WorkbenchTabBar tabs={tabs} activeId="chat" onActivate={()=>{}} onClose={()=>{}} />)
    const chatTab = screen.getByText('聊天')
    expect(chatTab).toBeTruthy()
    const closeBtns = screen.getAllByTitle(/关闭/)
    expect(closeBtns).toHaveLength(2)
  })

  it('点击 tab 触发 onActivate(id),点击 close 触发 onClose', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(<WorkbenchTabBar tabs={tabs} activeId="chat" onActivate={onActivate} onClose={onClose} />)
    fireEvent.click(screen.getByText('A.java'))
    expect(onActivate).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
    fireEvent.click(screen.getAllByTitle(/关闭/)[0])
    expect(onClose).toHaveBeenCalledWith('file:d:\\wraith\\A.java')
  })

  it('active tab 渲染 wb-tab-active class(视觉契约)', () => {
    const activeId = tabs[1].id
    render(<WorkbenchTabBar tabs={tabs} activeId={activeId} onActivate={()=>{}} onClose={()=>{}} />)
    const activeTab = screen.getByRole('tab', { selected: true })
    expect(activeTab).toBeTruthy()
    expect(activeTab.className).toContain('wb-tab-active')
    expect(activeTab.textContent ?? '').toContain('A.java')
  })
})
