// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProjectRowMenu from '../src/renderer/components/ProjectRowMenu'
import type { ProjectRowData } from '../src/renderer/lib/projectsView'

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true },
    displayName: 'wraith', sessionCount: 12, lastSessionAt: '2026-08-05T11:00:00.000Z',
    ...over,
  }
}

function props(over: Partial<React.ComponentProps<typeof ProjectRowMenu>> = {}) {
  return {
    row: row(), active: false,
    onRename: vi.fn(), onArchiveChats: vi.fn(), onRemove: vi.fn(),
    ...over,
  }
}

function openMenu(): void {
  fireEvent.click(screen.getByTestId('project-row-menu'))
}

// Radix Popover 走 Portal 挂到 document.body,需要 ResizeObserver 桩
beforeEach(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  }
})

// 防止 DOM 在用例间泄漏 —— Radix Portal 会把内容挂到 body 上
afterEach(() => cleanup())

describe('ProjectRowMenu 菜单项', () => {
  it('三项都在:编辑项目 / 归档聊天 / 移除', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    expect(screen.getByTestId('project-menu-edit')).toBeTruthy()
    expect(screen.getByTestId('project-menu-archive')).toBeTruthy()
    expect(screen.getByTestId('project-menu-remove')).toBeTruthy()
  })

  it('归档聊天带上会话数量', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    expect(screen.getByTestId('project-menu-archive').textContent).toMatch(/12/)
  })

  it('无会话时归档聊天禁用', () => {
    render(<ProjectRowMenu {...props({ row: row({ sessionCount: 0 }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('概况未回(null)时归档聊天禁用', () => {
    render(<ProjectRowMenu {...props({ row: row({ sessionCount: null }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('目录不存在时归档聊天禁用,编辑与移除仍可用', () => {
    render(<ProjectRowMenu {...props({ row: row({ view: { path: '/gone', lastUsedAt: 1, exists: false } }) })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-archive') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-menu-edit') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('project-menu-remove') as HTMLButtonElement).disabled).toBe(false)
  })

  it('当前项目不可移出', () => {
    render(<ProjectRowMenu {...props({ active: true })} />)
    openMenu()
    expect((screen.getByTestId('project-menu-remove') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ProjectRowMenu 动作', () => {
  it('点归档聊天把 path 与数量交给上层(确认框在上层弹)', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-archive'))
    expect(p.onArchiveChats).toHaveBeenCalledWith('/home/me/wraith', 12)
  })

  it('点移除调 onRemove', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-remove'))
    expect(p.onRemove).toHaveBeenCalledWith('/home/me/wraith')
  })
})

describe('ProjectRowMenu 编辑弹窗', () => {
  it('点编辑项目开弹窗,预填别名与只读路径', () => {
    render(<ProjectRowMenu {...props({ row: row({ view: { path: '/home/me/wraith', name: '主仓', lastUsedAt: 1, exists: true } }) })} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))

    expect(screen.getByTestId('project-edit-dialog')).toBeTruthy()
    expect((screen.getByTestId('project-edit-name') as HTMLInputElement).value).toBe('主仓')
    expect((screen.getByTestId('project-edit-path') as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByTestId('project-edit-path') as HTMLInputElement).value).toBe('/home/me/wraith')
  })

  it('没有别名时输入框是空的(而不是填目录名)', () => {
    render(<ProjectRowMenu {...props()} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    expect((screen.getByTestId('project-edit-name') as HTMLInputElement).value).toBe('')
  })

  it('保存调 onRename', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: '  新名字  ' } })
    fireEvent.click(screen.getByTestId('project-edit-save'))
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', '新名字')
  })

  it('清空别名后保存传空串(上层据此回落目录名)', () => {
    const p = props({ row: row({ view: { path: '/home/me/wraith', name: '主仓', lastUsedAt: 1, exists: true } }) })
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('project-edit-save'))
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', '')
  })

  it('Enter 等于保存', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('project-edit-name'), { key: 'Enter' })
    expect(p.onRename).toHaveBeenCalledWith('/home/me/wraith', 'x')
  })

  it('Escape 不保存', () => {
    const p = props()
    render(<ProjectRowMenu {...p} />)
    openMenu()
    fireEvent.click(screen.getByTestId('project-menu-edit'))
    fireEvent.change(screen.getByTestId('project-edit-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('project-edit-name'), { key: 'Escape' })
    expect(p.onRename).not.toHaveBeenCalled()
  })
})
