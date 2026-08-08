import { describe, it, expect } from 'vitest'
import { buildStaticItems, filterPalette } from '../src/renderer/lib/commandPalette'

const sessions = [{ id: 's1', title: '总结论文' }, { id: 's2', title: '打招呼' }]
const projects = [{ path: '/x/wraith', name: 'wraith' } as never]

describe('buildStaticItems', () => {
  it('2 命令 + 13 导航 = 15 项,含 new/settings', () => {
    const items = buildStaticItems()
    expect(items).toHaveLength(15)
    expect(items.filter(i => i.group === 'command').map(i => i.action)).toEqual(['new', 'settings'])
    expect(items.filter(i => i.group === 'nav')).toHaveLength(13)
    expect(items.find(i => i.action === 'new')?.hint).toBe('⌘N')
  })

  // 「文档」面板首版漏登记 NAV_ITEMS:其余 11 个面板都能从 ⌘K 到达,只有它不行。
  // 数量断言挡不住这种遗漏(改数字就绿了),所以按 action 点名断言。
  it('每个功能面板都能从 ⌘K 到达(含最新加的 documents/projects)', () => {
    const navActions = buildStaticItems().filter(i => i.group === 'nav').map(i => i.action)
    for (const panel of [
      'plugins', 'automations', 'im-gateway', 'providers', 'skills', 'memory',
      'snapshots', 'tasks', 'policy', 'browser', 'rag', 'documents', 'projects',
    ]) {
      expect(navActions).toContain('view:' + panel)
    }
  })
})

describe('filterPalette', () => {
  const stat = buildStaticItems()
  it('空 query:全部分组,flat 顺序 会话→项目→命令→导航', () => {
    const { groups, flat } = filterPalette('', sessions, projects, stat)
    expect(groups.map(g => g.title)).toEqual(['会话', '项目', '命令', '导航'])
    expect(flat[0]!.action).toBe('session:s1')
    expect(flat.length).toBe(2 + 1 + 15)
  })
  it('query 过滤会话 + 命令(不区分大小写 contains)', () => {
    const { groups } = filterPalette('招呼', sessions, projects, stat)
    expect(groups.find(g => g.title === '会话')!.items.map(i => i.action)).toEqual(['session:s2'])
    expect(groups.find(g => g.title === '会话')).toBeTruthy()
  })
  it('空组不出现', () => {
    const { groups } = filterPalette('设置', sessions, projects, stat)
    expect(groups.some(g => g.title === '命令')).toBe(true)
    expect(groups.some(g => g.title === '会话')).toBe(false)
  })
})
