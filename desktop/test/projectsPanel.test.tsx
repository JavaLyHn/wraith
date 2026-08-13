// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ProjectsPanel from '../src/renderer/components/ProjectsPanel'
import type { ProjectView } from '../src/shared/types'

function pv(path: string, over: Partial<ProjectView> = {}): ProjectView {
  return { path, lastUsedAt: 1, exists: true, ...over }
}

function props(over: Partial<React.ComponentProps<typeof ProjectsPanel>> = {}) {
  return {
    projects: [pv('/work/wraith'), pv('/work/api-server')],
    activePath: '/work/wraith',
    busy: false,
    onOpen: vi.fn(), onNewConversation: vi.fn(), onToggleStar: vi.fn(),
    onOpenSession: vi.fn(), onRename: vi.fn(), onArchiveChats: vi.fn(),
    onRemove: vi.fn(), onAdd: vi.fn(), onMove: vi.fn(),
    ...over,
  }
}

let summarySpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Radix Popover 走 Portal,需要 ResizeObserver 桩
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  }
  summarySpy = vi.fn().mockResolvedValue({
    summaries: [
      { path: '/work/wraith', sessionCount: 12, lastSessionAt: '2026-08-05T11:00:00.000Z' },
      { path: '/work/api-server', sessionCount: 3, lastSessionAt: '2026-08-05T04:00:00.000Z' },
    ],
  })
  // 用 (window as ...) 而不是 globalThis.window —— 后者在某些 jsdom 版本下链路不稳
  ;(window as unknown as { wraith: unknown }).wraith = {
    projectSummary: summarySpy,
    listSessionsForProject: vi.fn().mockResolvedValue({ sessions: [] }),
  }
})

// Radix Portal 会把内容挂到 body 上,用例间必须 cleanup 否则 DOM 泄漏
afterEach(() => cleanup())

describe('ProjectsPanel 概况拉取', () => {
  it('挂载时用全部项目路径批量拉一次概况', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1))
    expect(summarySpy).toHaveBeenCalledWith(['/work/wraith', '/work/api-server'])
  })

  it('概况回来前不显示会话数副标(骨架态,不显示 0)', () => {
    render(<ProjectsPanel {...props()} />)
    expect(screen.queryByText(/会话/)).toBeNull()
  })

  it('概况失败时仍渲染项目列表,不整页崩', async () => {
    summarySpy.mockRejectedValue(new Error('backend down'))
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(screen.getByText('wraith')).toBeTruthy())
    expect(screen.getByText('api-server')).toBeTruthy()
  })

  it('项目列表变化时重新拉概况', async () => {
    const { rerender } = render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1))

    rerender(<ProjectsPanel {...props({ projects: [pv('/work/wraith'), pv('/work/api-server'), pv('/work/newone')] })} />)

    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(2))
    expect(summarySpy).toHaveBeenLastCalledWith(['/work/wraith', '/work/api-server', '/work/newone'])
  })
})

describe('ProjectsPanel 搜索', () => {
  it('输入后只留命中的行', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('projects-search'), { target: { value: 'api' } })

    expect(screen.getByText('api-server')).toBeTruthy()
    expect(screen.queryByText('wraith')).toBeNull()
  })

  it('都不命中时出「没有匹配的项目」而不是空白', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('projects-search'), { target: { value: 'zzzz' } })

    expect(screen.getByTestId('projects-no-match')).toBeTruthy()
  })
})

describe('ProjectsPanel 排序', () => {
  it('默认按已更新倒序', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/wraith/)
    expect(names[1]).toMatch(/api-server/)
  })

  it('点「已更新」表头翻向', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('projects-sort-updated'))

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
  })

  it('点「名称」表头切到按名称升序', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('projects-sort-name'))

    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
    expect(names[1]).toMatch(/wraith/)
  })
})

describe('ProjectsPanel 重点分区', () => {
  it('有重点项目时出分区标题,重点行在其余行之前', async () => {
    render(<ProjectsPanel {...props({
      projects: [pv('/work/wraith'), pv('/work/api-server', { starred: true })],
    })} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())

    expect(screen.getByTestId('projects-starred-section')).toBeTruthy()
    const names = screen.getAllByTestId('project-row-open').map(b => b.textContent ?? '')
    expect(names[0]).toMatch(/api-server/)
  })

  it('没有重点项目时不渲染分区标题', async () => {
    render(<ProjectsPanel {...props()} />)
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())
    expect(screen.queryByTestId('projects-starred-section')).toBeNull()
  })
})

describe('ProjectsPanel 空态', () => {
  it('一个项目都没有时出空态与添加按钮', () => {
    render(<ProjectsPanel {...props({ projects: [] })} />)
    expect(screen.getByTestId('projects-empty')).toBeTruthy()
    fireEvent.click(screen.getByTestId('projects-add'))
    expect(screen.queryByTestId('projects-search')).toBeNull()
  })

  it('项目为空时不发概况请求', () => {
    render(<ProjectsPanel {...props({ projects: [] })} />)
    expect(summarySpy).not.toHaveBeenCalled()
  })
})
