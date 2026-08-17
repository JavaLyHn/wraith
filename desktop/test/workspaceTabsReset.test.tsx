// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React, { useState } from 'react'
import { useWorkspaceTabsReset } from '../src/renderer/lib/useWorkspaceTabsReset'
import type { WorkbenchTab } from '../src/renderer/components/WorkbenchTabBar'

afterEach(() => cleanup())

/** 宿主:模拟 App 的 tabs/activeTabId 状态 + hook 接线,暴露只读视图供断言 */
function Host({ workspace }: { workspace: string }) {
  const [tabs, setTabs] = useState<WorkbenchTab[]>([
    { id: 'chat', title: '聊天' },
    { id: 'file:d:\\old\\A.java', title: 'A.java', path: 'd:\\old\\A.java', kind: 'code' },
  ])
  const [activeTabId, setActiveTabId] = useState('file:d:\\old\\A.java')
  useWorkspaceTabsReset(workspace, setTabs, setActiveTabId)
  return (
    <div>
      <div data-testid="tab-count">{tabs.length}</div>
      <div data-testid="active-tab">{activeTabId}</div>
    </div>
  )
}

describe('useWorkspaceTabsReset — 切 workspace 即清文件 tab', () => {
  it('首挂不重置:已打开的 file tab 保持(初始化载入历史前的守卫)', () => {
    render(<Host workspace="d:\\old" />)
    expect(screen.getByTestId('tab-count').textContent).toBe('2')
    expect(screen.getByTestId('active-tab').textContent).toBe('file:d:\\old\\A.java')
  })

  it('workspace 不变的 re-render 不重置(不做无谓清空)', () => {
    const { rerender } = render(<Host workspace="d:\\old" />)
    rerender(<Host workspace="d:\\old" />)
    expect(screen.getByTestId('tab-count').textContent).toBe('2')
  })

  it('核心回归:workspace 切换 → tabs 回到仅聊天、activeTabId 回 chat', () => {
    // 模拟用户先打开过文件 tab,再切换项目 —— 旧 tab 的绝对路径已失效
    const { rerender } = render(<Host workspace="d:\\old" />)
    rerender(<Host workspace="d:\\new" />)
    expect(screen.getByTestId('tab-count').textContent).toBe('1')
    expect(screen.getByTestId('active-tab').textContent).toBe('chat')
  })

  it('连续两次切换都正确重置(ref 随动,不卡在第一次)', () => {
    const { rerender } = render(<Host workspace="d:\\a" />)
    rerender(<Host workspace="d:\\b" />)
    // 重新打开文件的时机无法在 Host 外模拟,但再次切换仍应触发重置逻辑
    // (tabs 已是 [chat],重置是幂等无操作;断言不崩溃且回到 chat)
    rerender(<Host workspace="d:\\c" />)
    expect(screen.getByTestId('tab-count').textContent).toBe('1')
    expect(screen.getByTestId('active-tab').textContent).toBe('chat')
  })
})
