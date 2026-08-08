import { describe, it, expect } from 'vitest'
import { buildArchiveRows, filterArchive, archiveProjectOptions } from '../src/renderer/lib/archiveView'
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

describe('buildArchiveRows', () => {
  it('项目标签取别名', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(rows[0]!.projectLabel).toBe('主仓')
  })

  it('无别名的项目取目录名', () => {
    const rows = buildArchiveRows([meta({ cwd: '/work/api-server' })], projects)
    expect(rows[0]!.projectLabel).toBe('api-server')
  })

  it('cwd 不在已知项目里也回落目录名,不显示空白', () => {
    const rows = buildArchiveRows([meta({ cwd: '/tmp/scratch' })], projects)
    expect(rows[0]!.projectLabel).toBe('scratch')
  })

  it('displayName 优先用自定义名', () => {
    const rows = buildArchiveRows([meta({ name: '分支排查' })], projects)
    expect(rows[0]!.displayName).toBe('分支排查')
  })

  it('无自定义名时用 title', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(rows[0]!.displayName).toBe('当前代码有多少分支')
  })

  it('保持传入顺序(后端已按 archivedAt 倒序)', () => {
    const rows = buildArchiveRows([meta({ id: 'a' }), meta({ id: 'b' })], projects)
    expect(rows.map(r => r.meta.id)).toEqual(['a', 'b'])
  })
})

describe('filterArchive', () => {
  const rows = buildArchiveRows([
    meta({ id: 'a', title: '登录报 500' }),
    meta({ id: 'b', title: '重构 Foo', cwd: '/work/api-server' }),
  ], projects)

  it('按标题搜索', () => {
    expect(filterArchive(rows, '登录', null).map(r => r.meta.id)).toEqual(['a'])
  })

  it('搜索不区分大小写', () => {
    expect(filterArchive(rows, 'FOO', null).map(r => r.meta.id)).toEqual(['b'])
  })

  it('按项目筛选', () => {
    expect(filterArchive(rows, '', '/work/api-server').map(r => r.meta.id)).toEqual(['b'])
  })

  it('项目筛选为 null 时回全部', () => {
    expect(filterArchive(rows, '', null)).toHaveLength(2)
  })

  it('搜索与项目筛选是与关系', () => {
    expect(filterArchive(rows, '登录', '/work/api-server')).toEqual([])
  })
})

describe('archiveProjectOptions', () => {
  it('首项是「全部」,值为空串', () => {
    const rows = buildArchiveRows([meta()], projects)
    expect(archiveProjectOptions(rows)[0]).toEqual({ value: '', label: '全部' })
  })

  it('只列出归档条目实际涉及的项目,不列全部已知项目', () => {
    const rows = buildArchiveRows([meta({ cwd: '/work/wraith' })], projects)
    const opts = archiveProjectOptions(rows)
    expect(opts).toHaveLength(2)   // 全部 + 主仓
    expect(opts[1]).toEqual({ value: '/work/wraith', label: '主仓' })
  })

  it('同一项目多条归档只出现一次', () => {
    const rows = buildArchiveRows([meta({ id: 'a' }), meta({ id: 'b' })], projects)
    expect(archiveProjectOptions(rows)).toHaveLength(2)
  })
})
