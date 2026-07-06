import { describe, it, expect } from 'vitest'
import { groupSkillsBySource } from '../src/renderer/lib/skillsView'
import type { SkillView } from '../src/shared/types'

const sk = (name: string, source: SkillView['source']): SkillView =>
  ({ name, description: '', version: '', author: '', tags: [], source, enabled: true })

describe('groupSkillsBySource', () => {
  it('按来源分组,组序固定 内置→用户→项目,组内保序', () => {
    const groups = groupSkillsBySource([sk('a', 'user'), sk('b', 'builtin'), sk('c', 'project'), sk('d', 'user')])
    expect(groups.map(g => g.source)).toEqual(['builtin', 'user', 'project'])
    expect(groups.map(g => g.label)).toEqual(['内置', '用户', '项目'])
    expect(groups.find(g => g.source === 'user')!.skills.map(s => s.name)).toEqual(['a', 'd'])
  })
  it('空组省略', () => {
    const groups = groupSkillsBySource([sk('b', 'builtin')])
    expect(groups.map(g => g.source)).toEqual(['builtin'])
  })
  it('空输入返回空数组', () => {
    expect(groupSkillsBySource([])).toEqual([])
  })
})
