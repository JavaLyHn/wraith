// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ProjectRow from '../src/renderer/components/ProjectRow'
import type { ProjectRowData } from '../src/renderer/lib/projectsView'
import type { SessionMeta } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/a', createdAt: 'c', updatedAt: '2026-08-05T11:00:00.000Z',
    provider: 'p', model: 'm', title: '接上一轮 Skill 优化工作', turns: 2, ...over,
  }
}

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true },
    displayName: 'wraith', sessionCount: 3,
    lastSessionAt: '2026-08-05T11:00:00.000Z',
    ...over,
  }
}

const NOW = Date.parse('2026-08-05T12:00:00.000Z')

function props(over: Partial<React.ComponentProps<typeof ProjectRow>> = {}) {
  return {
    row: row(), active: false, busy: false, now: NOW,
    onOpen: vi.fn(), onNewConversation: vi.fn(),
    onToggleStar: vi.fn(), onOpenSession: vi.fn(),
    ...over,
  }
}

let listSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  listSpy = vi.fn().mockResolvedValue({ sessions: [meta(), meta({ id: 's2', title: '你好' })] })
  ;(window as unknown as { wraith: unknown }).wraith = {
    listSessionsForProject: listSpy,
  }
})

afterEach(() => cleanup())

describe('ProjectRow 基本渲染', () => {
  it('显示名称、会话数、相对时间', () => {
    render(<ProjectRow {...props()} />)
    expect(screen.getByText('wraith')).toBeTruthy()
    expect(screen.getByText(/3 会话/)).toBeTruthy()
    expect(screen.getByText('1 小时')).toBeTruthy()
  })

  it('无会话时显示「无会话」与破折号', () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: 0, lastSessionAt: null }) })} />)
    expect(screen.getByText(/无会话/)).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('概况未回(sessionCount=null)时不显示会话数副标', () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: null, lastSessionAt: null }) })} />)
    expect(screen.queryByText(/会话/)).toBeNull()
  })
})

describe('ProjectRow 动作', () => {
  it('点行主体调 onOpen', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-open'))
    expect(p.onOpen).toHaveBeenCalledWith('/home/me/wraith')
  })

  it('点 ✎ 调 onNewConversation', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-new'))
    expect(p.onNewConversation).toHaveBeenCalledWith('/home/me/wraith')
  })

  it('点 ☆ 调 onToggleStar,传取反后的值', () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-star'))
    expect(p.onToggleStar).toHaveBeenCalledWith('/home/me/wraith', true)
  })

  it('已是重点时点 ☆ 传 false', () => {
    const p = props({ row: row({ view: { path: '/home/me/wraith', lastUsedAt: 1, exists: true, starred: true } }) })
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-star'))
    expect(p.onToggleStar).toHaveBeenCalledWith('/home/me/wraith', false)
  })
})

describe('ProjectRow busy 守卫', () => {
  it('busy 时行主体与 ✎ 禁用', () => {
    render(<ProjectRow {...props({ busy: true })} />)
    expect((screen.getByTestId('project-row-open') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-row-new') as HTMLButtonElement).disabled).toBe(true)
  })

  it('busy 时 ☆ 与展开仍可用 —— 前者纯 settings,后者只读', () => {
    render(<ProjectRow {...props({ busy: true })} />)
    expect((screen.getByTestId('project-row-star') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('project-row-expand') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ProjectRow 展开懒加载', () => {
  it('首次展开才请求会话', async () => {
    render(<ProjectRow {...props()} />)
    expect(listSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('project-row-expand'))

    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))
    expect(listSpy).toHaveBeenCalledTimes(1)
    expect(listSpy).toHaveBeenCalledWith('/home/me/wraith', 5)
  })

  it('折叠再展开不重复请求(缓存不清)', async () => {
    render(<ProjectRow {...props()} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('project-row-expand'))   // 折叠
    await waitFor(() => expect(screen.queryByTestId('project-row-session')).toBeNull())
    fireEvent.click(screen.getByTestId('project-row-expand'))   // 再展开
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    expect(listSpy).toHaveBeenCalledTimes(1)
  })

  it('点展开里的会话调 onOpenSession', async () => {
    const p = props()
    render(<ProjectRow {...p} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    fireEvent.click(screen.getAllByTestId('project-row-session')[1]!)
    expect(p.onOpenSession).toHaveBeenCalledWith('/home/me/wraith', 's2')
  })

  it('会话数超过 5 时出「查看全部」', async () => {
    listSpy.mockResolvedValue({ sessions: [meta(), meta({ id: 's2' }), meta({ id: 's3' }), meta({ id: 's4' }), meta({ id: 's5' })] })
    render(<ProjectRow {...props({ row: row({ sessionCount: 12 }) })} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))

    await waitFor(() => expect(screen.getByTestId('project-row-view-all')).toBeTruthy())
  })

  it('会话数不超过 5 时不出「查看全部」', async () => {
    render(<ProjectRow {...props({ row: row({ sessionCount: 2 }) })} />)
    fireEvent.click(screen.getByTestId('project-row-expand'))
    await waitFor(() => expect(screen.getAllByTestId('project-row-session')).toHaveLength(2))

    expect(screen.queryByTestId('project-row-view-all')).toBeNull()
  })
})

describe('ProjectRow 目录不存在', () => {
  const missing = row({ view: { path: '/gone', lastUsedAt: 1, exists: false } })

  it('显示「目录不存在」,不显示时间', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect(screen.getByTestId('project-row-missing')).toBeTruthy()
  })

  it('不渲染展开 / ☆ / ✎', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect(screen.queryByTestId('project-row-expand')).toBeNull()
    expect(screen.queryByTestId('project-row-star')).toBeNull()
    expect(screen.queryByTestId('project-row-new')).toBeNull()
  })

  it('行主体禁用', () => {
    render(<ProjectRow {...props({ row: missing })} />)
    expect((screen.getByTestId('project-row-open') as HTMLButtonElement).disabled).toBe(true)
  })
})
