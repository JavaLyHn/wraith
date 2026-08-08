// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SettingsArchive from '../src/renderer/components/SettingsArchive'
import type { SessionMeta, ProjectView } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/work/wraith', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '当前代码有多少分支', turns: 2,
    archivedAt: '2026-08-05T09:00:00.000Z', ...over,
  }
}

const projects: ProjectView[] = [
  { path: '/work/wraith', name: '主仓', lastUsedAt: 2, exists: true },
  { path: '/work/api-server', lastUsedAt: 1, exists: true },
]

let listArchived: ReturnType<typeof vi.fn>
let setArchived: ReturnType<typeof vi.fn>
let deleteSession: ReturnType<typeof vi.fn>
let onChanged: ReturnType<typeof vi.fn>

beforeEach(() => {
  listArchived = vi.fn().mockResolvedValue({
    sessions: [meta(), meta({ id: 's2', title: '重构 Foo', cwd: '/work/api-server' })],
  })
  setArchived = vi.fn().mockResolvedValue({ ok: true })
  deleteSession = vi.fn().mockResolvedValue({ ok: true })
  onChanged = vi.fn()
  ;(window as unknown as { wraith: unknown }).wraith = {
    listProjects: vi.fn().mockResolvedValue({ projects }),
    listArchivedSessions: listArchived,
    setSessionArchived: setArchived,
    deleteSession,
  }
})

afterEach(() => cleanup())

async function renderPanel(): Promise<void> {
  render(<SettingsArchive onArchiveChanged={onChanged} />)
  await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
}

describe('SettingsArchive 拉取', () => {
  it('用全部已知项目路径拉跨项目归档', async () => {
    await renderPanel()
    expect(listArchived).toHaveBeenCalledWith(['/work/wraith', '/work/api-server'])
  })

  it('每行显示项目标签与归档相对时间', async () => {
    await renderPanel()
    expect(screen.getByText(/主仓/)).toBeTruthy()
    expect(screen.getByText(/api-server/)).toBeTruthy()
    expect(screen.getAllByText(/归档于/).length).toBeGreaterThan(0)
  })

  it('刚归档的显示「刚刚归档」而不是「归档于 刚刚前」', async () => {
    const justNow = new Date().toISOString()
    listArchived.mockResolvedValue({ sessions: [meta({ archivedAt: justNow })] })
    render(<SettingsArchive onArchiveChanged={onChanged} />)

    await waitFor(() => expect(screen.getByTestId('archive-row')).toBeTruthy())
    expect(screen.getByText(/刚刚归档/)).toBeTruthy()
    expect(screen.queryByText(/刚刚前/)).toBeNull()
  })

  it('一条都没有时出空态与引导', async () => {
    listArchived.mockResolvedValue({ sessions: [] })
    render(<SettingsArchive onArchiveChanged={onChanged} />)
    await waitFor(() => expect(screen.getByTestId('archive-empty')).toBeTruthy())
  })
})

describe('SettingsArchive 跨项目 path 参数(spec §5.2 回归)', () => {
  it('恢复时必须把该条的 cwd 作为第三个参数传出去', async () => {
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[1]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    expect(setArchived).toHaveBeenCalledWith('s2', false, '/work/api-server')
  })

  it('永久删除时必须把该条的 cwd 作为第二个参数传出去', async () => {
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-delete')[1]!)   // 第一次点=进确认态
    fireEvent.click(screen.getAllByTestId('archive-delete')[1]!)   // 第二次点=真删

    await waitFor(() => expect(deleteSession).toHaveBeenCalled())
    expect(deleteSession).toHaveBeenCalledWith('s2', '/work/api-server')
  })
})

describe('SettingsArchive 二步确认', () => {
  it('第一次点删除不真删', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('恢复不需要二步确认', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)
    await waitFor(() => expect(setArchived).toHaveBeenCalledTimes(1))
  })
})

describe('SettingsArchive 成功后的收尾', () => {
  it('恢复成功后该行消失并通知上层', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(1))
    expect(onChanged).toHaveBeenCalled()
  })

  it('删除成功后该行消失', async () => {
    await renderPanel()
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    fireEvent.click(screen.getAllByTestId('archive-delete')[0]!)
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(1))
  })
})

describe('SettingsArchive 失败回滚', () => {
  it('恢复回 ok:false 时那一行要回到列表', async () => {
    setArchived.mockResolvedValue({ ok: false })
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    // 乐观移除后必须回滚 —— 否则用户以为恢复成功了,刷新一下它又回到归档里
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
  })

  it('恢复抛异常时那一行也要回到列表', async () => {
    setArchived.mockRejectedValue(new Error('backend down'))
    await renderPanel()

    fireEvent.click(screen.getAllByTestId('archive-restore')[0]!)

    await waitFor(() => expect(setArchived).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByTestId('archive-row')).toHaveLength(2))
  })
})

describe('SettingsArchive 搜索与筛选', () => {
  it('搜索只留命中的', async () => {
    await renderPanel()
    fireEvent.change(screen.getByTestId('archive-search'), { target: { value: '重构' } })
    expect(screen.getAllByTestId('archive-row')).toHaveLength(1)
  })

  it('都不命中出「没有匹配」而不是空白', async () => {
    await renderPanel()
    fireEvent.change(screen.getByTestId('archive-search'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('archive-no-match')).toBeTruthy()
  })
})
