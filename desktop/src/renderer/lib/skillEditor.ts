import type { SkillUpsertPayload } from '../../shared/types'

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
}

/** 表单态 → RPC 载荷(tags 经 parseTagsInput,name trim)。 */
export function toUpsertPayload(form: SkillFormState): SkillUpsertPayload {
  return {
    scope: form.scope,
    name: form.name.trim(),
    description: form.description,
    version: form.version,
    author: form.author,
    tags: parseTagsInput(form.tagsInput),
    body: form.body,
  }
}
