import { describe, it, expect } from 'vitest'
import { buildStaticItems, filterPalette } from '../src/renderer/lib/commandPalette'

const sessions = [{ id: 's1', title: '总结论文' }, { id: 's2', title: '打招呼' }]
const projects = [{ path: '/x/wraith', name: 'wraith' } as never]

describe('buildStaticItems', () => {
  it('2 命令 + 11 导航 = 13 项,含 new/settings', () => {
    const items = buildStaticItems()
    expect(items).toHaveLength(13)
    expect(items.filter(i => i.group === 'command').map(i => i.action)).toEqual(['new', 'settings'])
    expect(items.filter(i => i.group === 'nav')).toHaveLength(11)
    expect(items.find(i => i.action === 'new')?.hint).toBe('⌘N')
  })
})

describe('filterPalette', () => {
  const stat = buildStaticItems()
  it('空 query:全部分组,flat 顺序 会话→项目→命令→导航', () => {
    const { groups, flat } = filterPalette('', sessions, projects, stat)
    expect(groups.map(g => g.title)).toEqual(['会话', '项目', '命令', '导航'])
    expect(flat[0]!.action).toBe('session:s1')
    expect(flat.length).toBe(2 + 1 + 13)
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
