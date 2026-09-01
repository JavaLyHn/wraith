/** Skill view + detail + upsert payloads. */

export interface SkillView {
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  source: 'builtin' | 'user' | 'project'
  enabled: boolean
}

export interface SkillListResult {
  skills: SkillView[]
}

export interface SkillReference {
  path: string
  content: string
}
export interface SkillDetail extends SkillView {
  body: string
  references?: SkillReference[]
}

export interface SkillUpsertPayload {
  scope: 'user' | 'project'
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  body: string
  references?: SkillReference[]
}

// ---------------------------------------------------------------------------
// Phase E-2: 定时自动化
