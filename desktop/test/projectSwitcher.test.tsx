// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProjectSwitcher from '../src/renderer/components/ProjectSwitcher'
import type { ProjectView } from '../src/shared/types'

function pv(path: string, over: Partial<ProjectView> = {}): ProjectView {
  return { path, lastUsedAt: 1, exists: true, ...over }
}

function props(over: Partial<React.ComponentProps<typeof ProjectSwitcher>> = {}) {
  return {
    projects: [pv('/w/a'), pv('/w/b')],
    activePath: '/w/a',
    busy: false,
    onActivate: vi.fn(), onAdd: vi.fn(), onOpenAllProjects: vi.fn(),
    ...over,
  }
}

function open(): void {
  fireEvent.click(screen.getByTestId('project-switcher'))
}

// Radix Popover 走 Portal,需要 ResizeObserver 桩
beforeEach(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  }
})

// Radix Portal 会把内容挂到 body 上,用例间必须 cleanup 否则 DOM 泄漏
afterEach(() => cleanup())

describe('ProjectSwitcher 触发器', () => {
  it('显示当前项目名', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a', { name: '主仓' })] })} />)
    expect(screen.getByTestId('project-switcher').textContent).toMatch(/主仓/)
  })

  it('无别名时回落目录名', () => {
    render(<ProjectSwitcher {...props()} />)
    expect(screen.getByTestId('project-switcher').textContent).toMatch(/a/)
  })
})

describe('ProjectSwitcher 列表', () => {
  it('重点项目排在前面', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a'), pv('/w/zz', { starred: true })] })} />)
    open()
    const items = screen.getAllByTestId('project-item').map(b => b.textContent ?? '')
    expect(items[0]).toMatch(/zz/)
  })

  it('非重点最多列 5 个,重点不占配额', () => {
    const many = [
      pv('/w/s1', { starred: true }), pv('/w/s2', { starred: true }),
      pv('/w/r1'), pv('/w/r2'), pv('/w/r3'), pv('/w/r4'), pv('/w/r5'), pv('/w/r6'), pv('/w/r7'),
    ]
    render(<ProjectSwitcher {...props({ projects: many, activePath: '/w/s1' })} />)
    open()
    expect(screen.getAllByTestId('project-item')).toHaveLength(7)   // 2 重点 + 5 其余
  })

  it('点非当前项目调 onActivate', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getAllByTestId('project-item')[1]!)
    expect(p.onActivate).toHaveBeenCalledWith('/w/b')
  })

  it('点当前项目只收面板,不调 onActivate', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getAllByTestId('project-item')[0]!)
    expect(p.onActivate).not.toHaveBeenCalled()
  })

  it('busy 时列表项禁用', () => {
    render(<ProjectSwitcher {...props({ busy: true })} />)
    open()
    expect((screen.getAllByTestId('project-item')[1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('目录不存在的项目禁用', () => {
    render(<ProjectSwitcher {...props({ projects: [pv('/w/a'), pv('/w/gone', { exists: false })] })} />)
    open()
    expect((screen.getAllByTestId('project-item')[1] as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ProjectSwitcher 底部两项', () => {
  it('「全部项目…」调 onOpenAllProjects', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getByTestId('project-view-all'))
    expect(p.onOpenAllProjects).toHaveBeenCalled()
  })

  it('「添加项目…」调 onAdd', () => {
    const p = props()
    render(<ProjectSwitcher {...p} />)
    open()
    fireEvent.click(screen.getByTestId('project-add'))
    expect(p.onAdd).toHaveBeenCalled()
  })

  it('busy 时「添加项目…」禁用,「全部项目…」仍可用', () => {
    render(<ProjectSwitcher {...props({ busy: true })} />)
    open()
    expect((screen.getByTestId('project-add') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-view-all') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ProjectSwitcher 不再承载的操作', () => {
  it('没有改名与移出按钮(搬进项目面板了)', () => {
    render(<ProjectSwitcher {...props()} />)
    open()
    expect(screen.queryByTestId('project-rename')).toBeNull()
    expect(screen.queryByTestId('project-remove')).toBeNull()
  })
})
