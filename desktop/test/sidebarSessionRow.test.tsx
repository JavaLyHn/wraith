// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionRow, default as Sidebar } from '../src/renderer/components/Sidebar'
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

  it('2. 改名按钮已删除(双击改名覆盖该功能),不再渲染 session-rename', () => {
    render(<SessionRow {...props()} />)
    expect(screen.queryByTestId('session-rename')).toBeNull()
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

describe('跨分区拖拽:拖进重点区 = 加星,拖回对话区 = 取消', () => {
  // jsdom 的 dragstart/drop 需要 mock dataTransfer
  const dt = (): DataTransfer => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' } as unknown as DataTransfer)
  const starred1 = meta({ id: 'star1', title: '已收藏A', starred: true })
  const starred2 = meta({ id: 'star2', title: '已收藏B', starred: true })
  const rest1 = meta({ id: 'rest1', title: '普通A' })
  const rest2 = meta({ id: 'rest2', title: '普通B' })

  function renderSidebar(onReorderSession: ReturnType<typeof vi.fn>): void {
    render(<Sidebar
      workspace="d:/wrk" projects={[]} busy={false}
      sessions={[starred1, starred2, rest1, rest2]}
      activeSessionId="" runningSessionId="" newDraftActive={false}
      onNewConversation={() => {}} onSelectSession={() => {}}
      onToggleStar={() => {}} onRenameSession={() => {}} onArchiveSession={() => {}}
      onReorderSession={onReorderSession}
      onActivateProject={() => {}} onAddProject={() => {}} onOpenAllProjects={() => {}}
      profile={{ name: '', avatar: '' } as never} automationBadge={false} taskActiveCount={0}
      onOpenSearch={() => {}} onOpenPlugins={() => {}} onOpenAutomations={() => {}}
      onOpenImGateway={() => {}} onOpenProviders={() => {}} onOpenSkills={() => {}}
      onOpenMemory={() => {}} onOpenSnapshots={() => {}} onOpenTasks={() => {}}
      onOpenPolicy={() => {}} onOpenBrowser={() => {}} onOpenRag={() => {}}
      onOpenDocuments={() => {}} onOpenSettings={() => {}}
      activeNav={null}
    />)
  }
  const rowById = (id: string): HTMLElement => {
    // conversation-item 按钮在 SessionRow 根 div 内,拿按钮再向上找 draggable 根
    const btn = screen.getAllByTestId('conversation-item')
      .find(b => b.textContent?.includes(id === 'star1' ? '已收藏A' : id === 'star2' ? '已收藏B' : id === 'rest1' ? '普通A' : '普通B'))
    if (!btn) throw new Error('row not found: ' + id)
    const root = btn.closest('[draggable="true"]')
    if (!root) throw new Error('draggable root not found')
    return root as HTMLElement
  }

  it('1. 普通会话拖到重点区行上 → onReorderSession 带 targetSection=starred', () => {
    const onReorder = vi.fn()
    renderSidebar(onReorder)
    fireEvent.dragStart(rowById('rest1'), { dataTransfer: dt() })
    fireEvent.dragOver(rowById('star1'), { dataTransfer: dt() })
    fireEvent.drop(rowById('star1'), { dataTransfer: dt() })
    expect(onReorder).toHaveBeenCalledWith('rest1', 'star1', 'starred')
  })
  it('2. 重点会话拖回对话区行上 → onReorderSession 带 targetSection=rest', () => {
    const onReorder = vi.fn()
    renderSidebar(onReorder)
    fireEvent.dragStart(rowById('star2'), { dataTransfer: dt() })
    fireEvent.drop(rowById('rest2'), { dataTransfer: dt() })
    expect(onReorder).toHaveBeenCalledWith('star2', 'rest2', 'rest')
  })
  it('3. 同分区(重点⇄重点)拖拽 → targetSection=starred(星标无变化由 App 层判定)', () => {
    const onReorder = vi.fn()
    renderSidebar(onReorder)
    fireEvent.dragStart(rowById('star2'), { dataTransfer: dt() })
    fireEvent.drop(rowById('star1'), { dataTransfer: dt() })
    expect(onReorder).toHaveBeenCalledWith('star2', 'star1', 'starred')
  })
  it('4. 同分区(普通⇄普通)拖拽 → targetSection=rest', () => {
    const onReorder = vi.fn()
    renderSidebar(onReorder)
    fireEvent.dragStart(rowById('rest2'), { dataTransfer: dt() })
    fireEvent.drop(rowById('rest1'), { dataTransfer: dt() })
    expect(onReorder).toHaveBeenCalledWith('rest2', 'rest1', 'rest')
  })
  it('5. 拖到自己身上 → 不触发 reorder', () => {
    const onReorder = vi.fn()
    renderSidebar(onReorder)
    fireEvent.dragStart(rowById('rest1'), { dataTransfer: dt() })
    fireEvent.drop(rowById('rest1'), { dataTransfer: dt() })
    expect(onReorder).not.toHaveBeenCalled()
  })
})
