import type { SkillView } from '../../shared/types'

/** 按来源分组:组序固定 内置→用户→项目;空组省略;组内保持传入顺序。 */
export function groupSkillsBySource(
  skills: SkillView[],
): { source: 'builtin' | 'user' | 'project'; label: string; skills: SkillView[] }[] {
  const order: Array<{ source: 'builtin' | 'user' | 'project'; label: string }> = [
    { source: 'builtin', label: '内置' },
    { source: 'user', label: '用户' },
    { source: 'project', label: '项目' },
  ]
  return order
    .map(o => ({ source: o.source, label: o.label, skills: skills.filter(s => s.source === o.source) }))
    .filter(g => g.skills.length > 0)
}
