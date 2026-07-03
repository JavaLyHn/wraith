import { describe, test, expect } from 'vitest'
import { filterSidebar } from '../src/renderer/lib/sidebarSearch'
import type { ProjectView } from '../src/shared/types'

const sessions = [
  { id: 's1', title: '第一段对话' },
  { id: 's2', title: 'Hello World' },
  { id: 's3', title: '' },
]

const projects: ProjectView[] = [
  { path: '/home/user/my-project', name: '我的项目', lastUsedAt: 2000, exists: true },
  { path: '/home/user/blog-site', name: undefined, lastUsedAt: 1000, exists: true },
]

describe('filterSidebar', () => {
  test('空 query 返回原列表;有 query 时按标题/路径尾段过滤(不区分大小写,空标题按未命名)', () => {
    // 空 query → 不过滤
    expect(filterSidebar(sessions, projects, '').sessions).toHaveLength(3)
    expect(filterSidebar(sessions, projects, '').projects).toHaveLength(2)

    // 会话标题大小写不敏感
    const r1 = filterSidebar(sessions, projects, 'hello')
    expect(r1.sessions.map(s => s.id)).toEqual(['s2'])

    // 空标题按「未命名」参与匹配
    const r2 = filterSidebar(sessions, projects, '未命名')
    expect(r2.sessions.map(s => s.id)).toContain('s3')
  })

  test('按项目显示名或路径尾段过滤', () => {
    // 按别名
    const r1 = filterSidebar(sessions, projects, '我的项目')
    expect(r1.projects.map(p => p.path)).toEqual(['/home/user/my-project'])

    // 按路径尾段(无别名)
    const r2 = filterSidebar(sessions, projects, 'blog-site')
    expect(r2.projects.map(p => p.path)).toEqual(['/home/user/blog-site'])
  })
})
