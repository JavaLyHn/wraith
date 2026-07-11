import type { SkillUpsertPayload, SkillReference } from '../../shared/types'

const SAFE_NAME = /^[A-Za-z0-9_-]+$/

/** 逗号或换行分隔 → trim → 去空 → 去重(保序)。 */
export function parseTagsInput(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** 校验技能名。合法返回 null,否则返回中文错误串(镜像后端 ^[A-Za-z0-9_-]+$)。 */
export function validateSkillName(name: string): string | null {
  if (!name || !name.trim()) return '技能名不能为空'
  if (!SAFE_NAME.test(name)) return '技能名只能包含字母、数字、下划线、连字符'
  return null
}

export interface SkillFormState {
  scope: 'user' | 'project'
  name: string
  description: string
  version: string
  author: string
  tagsInput: string
  body: string
  references: SkillReference[]
}

/** 归一参考文件:trim path、去空 path、按 path 去重(后者胜,保序)。 */
export function normalizeReferences(refs: SkillReference[]): SkillReference[] {
  const byPath = new Map<string, SkillReference>()
  for (const r of refs || []) {
    const path = (r.path || '').trim().replace(/^\/+/, '')
    if (!path) continue
    byPath.set(path, { path, content: r.content ?? '' })
  }
  return [...byPath.values()]
}

/** 表单态 → RPC 载荷(tags 经 parseTagsInput,name trim,references 归一)。 */
export function toUpsertPayload(form: SkillFormState): SkillUpsertPayload {
  return {
    scope: form.scope,
    name: form.name.trim(),
    description: form.description,
    version: form.version,
    author: form.author,
    tags: parseTagsInput(form.tagsInput),
    body: form.body,
    references: normalizeReferences(form.references),
  }
}

/** 移动作用域后需删除的旧 scope;未移动/新建/builtin 源→null(无需删)。 */
export function scopeToCleanup(
  initialSource: 'builtin' | 'user' | 'project' | undefined,
  formScope: 'user' | 'project',
): 'user' | 'project' | null {
  if (initialSource !== 'user' && initialSource !== 'project') return null
  return initialSource === formScope ? null : initialSource
}
