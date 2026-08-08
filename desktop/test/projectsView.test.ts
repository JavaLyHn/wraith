import { describe, it, expect } from 'vitest'
import {
  mergeSummaries, filterProjects, sortProjects, partitionStarredProjects, shortRelativeTime,
  type ProjectRowData,
} from '../src/renderer/lib/projectsView'
import type { ProjectView, ProjectSummary } from '../src/shared/types'

function pv(over: Partial<ProjectView> = {}): ProjectView {
  return { path: '/home/me/wraith', lastUsedAt: 1000, exists: true, ...over }
}

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: pv(), displayName: 'wraith', sessionCount: 3,
    lastSessionAt: '2026-08-05T10:00:00.000Z', ...over,
  }
}

describe('mergeSummaries', () => {
  it('按 path 对齐概况,顺序跟随 projects', () => {
    const projects = [pv({ path: '/a', name: '甲' }), pv({ path: '/b' })]
    const summaries: ProjectSummary[] = [
      { path: '/b', sessionCount: 1, lastSessionAt: '2026-08-05T09:00:00.000Z' },
      { path: '/a', sessionCount: 7, lastSessionAt: '2026-08-05T10:00:00.000Z' },
    ]

    const rows = mergeSummaries(projects, summaries)

    expect(rows.map(r => r.view.path)).toEqual(['/a', '/b'])
    expect(rows[0]!.sessionCount).toBe(7)
    expect(rows[0]!.displayName).toBe('甲')
    expect(rows[1]!.sessionCount).toBe(1)
  })

  it('概况还没回来的项目 sessionCount 是 null(渲染骨架用)', () => {
    const rows = mergeSummaries([pv({ path: '/a' })], [])
    expect(rows[0]!.sessionCount).toBeNull()
    expect(rows[0]!.lastSessionAt).toBeNull()
  })

  it('无 name 时 displayName 回落目录名', () => {
    const rows = mergeSummaries([pv({ path: '/home/me/my-proj' })], [])
    expect(rows[0]!.displayName).toBe('my-proj')
  })
})

describe('filterProjects', () => {
  it('命中名称', () => {
    const rows = [row({ displayName: 'wraith' }), row({ displayName: 'other', view: pv({ path: '/home/me/other' }) })]
    expect(filterProjects(rows, 'wra').map(r => r.displayName)).toEqual(['wraith'])
  })

  it('命中路径 —— 同名不同路径的项目靠这个筛开', () => {
    const rows = [
      row({ displayName: 'wraith', view: pv({ path: '/work/alpha/wraith' }) }),
      row({ displayName: 'wraith', view: pv({ path: '/work/beta/wraith' }) }),
    ]
    expect(filterProjects(rows, 'alpha')).toHaveLength(1)
  })

  it('不区分大小写', () => {
    expect(filterProjects([row({ displayName: 'Wraith' })], 'wRA')).toHaveLength(1)
  })

  it('空查询回全量', () => {
    const rows = [row(), row()]
    expect(filterProjects(rows, '   ')).toHaveLength(2)
  })

  it('都不命中回空', () => {
    expect(filterProjects([row({ displayName: 'wraith' })], 'zzz')).toEqual([])
  })
})

describe('sortProjects', () => {
  const a = row({ displayName: 'alpha', lastSessionAt: '2026-08-05T08:00:00.000Z' })
  const b = row({ displayName: 'beta', lastSessionAt: '2026-08-05T10:00:00.000Z' })
  const none = row({ displayName: 'zeta', lastSessionAt: null })

  it('已更新倒序:新的在前', () => {
    expect(sortProjects([a, b], 'updated', 'desc').map(r => r.displayName)).toEqual(['beta', 'alpha'])
  })

  it('已更新正序:旧的在前', () => {
    expect(sortProjects([a, b], 'updated', 'asc').map(r => r.displayName)).toEqual(['alpha', 'beta'])
  })

  it('无会话的项目恒排末尾,不受方向影响', () => {
    expect(sortProjects([none, a, b], 'updated', 'desc').map(r => r.displayName))
      .toEqual(['beta', 'alpha', 'zeta'])
    expect(sortProjects([none, a, b], 'updated', 'asc').map(r => r.displayName))
      .toEqual(['alpha', 'beta', 'zeta'])
  })

  it('按名称排序不区分大小写', () => {
    const rows = [row({ displayName: 'beta' }), row({ displayName: 'Alpha' })]
    expect(sortProjects(rows, 'name', 'asc').map(r => r.displayName)).toEqual(['Alpha', 'beta'])
  })

  it('不改原数组', () => {
    const rows = [b, a]
    sortProjects(rows, 'name', 'asc')
    expect(rows.map(r => r.displayName)).toEqual(['beta', 'alpha'])
  })
})

describe('partitionStarredProjects', () => {
  it('重点与其余分开,各自保持传入顺序', () => {
    const s1 = row({ displayName: 's1', view: pv({ starred: true }) })
    const r1 = row({ displayName: 'r1' })
    const s2 = row({ displayName: 's2', view: pv({ starred: true }) })

    const { starred, rest } = partitionStarredProjects([s1, r1, s2])

    expect(starred.map(r => r.displayName)).toEqual(['s1', 's2'])
    expect(rest.map(r => r.displayName)).toEqual(['r1'])
  })

  it('没有重点时 starred 为空数组(组件据此不渲染分区标题)', () => {
    expect(partitionStarredProjects([row()]).starred).toEqual([])
  })
})

describe('shortRelativeTime', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z')
  const ago = (ms: number): string => new Date(now - ms).toISOString()

  it('null 回破折号', () => {
    expect(shortRelativeTime(null, now)).toBe('—')
  })

  it('不到 1 分钟', () => {
    expect(shortRelativeTime(ago(30_000), now)).toBe('刚刚')
  })

  it('59 分钟仍是分', () => {
    expect(shortRelativeTime(ago(59 * 60_000), now)).toBe('59 分')
  })

  it('60 分钟翻成 1 小时', () => {
    expect(shortRelativeTime(ago(60 * 60_000), now)).toBe('1 小时')
  })

  it('23 小时仍是小时', () => {
    expect(shortRelativeTime(ago(23 * 3600_000), now)).toBe('23 小时')
  })

  it('24 小时翻成 1 天', () => {
    expect(shortRelativeTime(ago(24 * 3600_000), now)).toBe('1 天')
  })

  it('29 天仍是天', () => {
    expect(shortRelativeTime(ago(29 * 86400_000), now)).toBe('29 天')
  })

  it('30 天翻成 1 个月', () => {
    expect(shortRelativeTime(ago(30 * 86400_000), now)).toBe('1 个月')
  })

  it('无法解析的时间戳回破折号,不抛', () => {
    expect(shortRelativeTime('not-a-date', now)).toBe('—')
  })

  it('未来时间当作刚刚,不出现负数', () => {
    expect(shortRelativeTime(new Date(now + 60_000).toISOString(), now)).toBe('刚刚')
  })
})
