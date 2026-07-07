import { useState } from 'react'
import type { SkillDetail } from '../../shared/types'
import { validateSkillName, toUpsertPayload, scopeToCleanup, type SkillFormState } from '../lib/skillEditor'
import Select from './ui/select'

interface Props {
  initial?: SkillDetail     // 编辑时预填;新建为 undefined
  lockName: boolean         // 编辑时锁 name
  lockScope: boolean        // 编辑时锁 scope
  onSaved: () => void
  onCancel: () => void
}

function initForm(initial?: SkillDetail): SkillFormState {
  return {
    scope: initial && initial.source !== 'builtin' ? initial.source : 'user',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    version: initial?.version ?? '',
    author: initial?.author ?? '',
    tagsInput: (initial?.tags ?? []).join(', '),
    body: initial?.body ?? '',
  }
}

export default function SkillEditor({ initial, lockName, lockScope, onSaved, onCancel }: Props): JSX.Element {
  const [form, setForm] = useState<SkillFormState>(() => initForm(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof SkillFormState>(k: K, v: SkillFormState[K]): void =>
    setForm(prev => ({ ...prev, [k]: v }))
  const nameError = validateSkillName(form.name)

  const save = async (): Promise<void> => {
    if (nameError) { setError(nameError); return }
    setSaving(true)
    try {
      const cleanup = scopeToCleanup(initial?.source, form.scope)
      if (cleanup) {
        const { exists } = await window.wraith.skillExistsInScope(form.scope, form.name)
        if (exists) {
          setError(`目标作用域「${form.scope}」已存在同名技能「${form.name}」，无法移动`)
          setSaving(false)
          return
        }
      }
      await window.wraith.upsertSkill(toUpsertPayload(form))
      if (cleanup) await window.wraith.deleteSkill(cleanup, form.name)
      onSaved()
    } catch (err) { setError((err as Error).message); setSaving(false) }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={onCancel} className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 取消</button>
        <span className="text-sm font-bold text-fg">{lockName ? '编辑技能' : '新建技能'}</span>
        <button data-testid="skill-save" onClick={() => void save()} disabled={saving || !!nameError}
          className="ml-auto rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skill-editor-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-fg-subtle">名称(目录名,字母/数字/_/-)</span>
            <input className={inputCls} value={form.name} disabled={lockName}
              onChange={e => set('name', e.target.value)} placeholder="my-skill" />
            {!lockName && form.name.length > 0 && nameError && <span className="text-3xs text-danger">{nameError}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-fg-subtle">来源</span>
            <Select
              testId="skill-scope-select"
              value={form.scope}
              disabled={lockScope}
              onChange={v => set('scope', v as 'user' | 'project')}
              options={[
                { value: 'user', label: '用户(~/.wraith/skills)' },
                { value: 'project', label: '项目(<项目>/.wraith/skills)' },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-fg-subtle">描述</span>
            <textarea className={inputCls} rows={2} value={form.description}
              onChange={e => set('description', e.target.value)} placeholder="一句话说明这个技能做什么" />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-2xs text-fg-subtle">版本</span>
              <input className={inputCls} value={form.version} onChange={e => set('version', e.target.value)} placeholder="1.0.0" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-2xs text-fg-subtle">作者</span>
              <input className={inputCls} value={form.author} onChange={e => set('author', e.target.value)} placeholder="me" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-fg-subtle">标签(逗号分隔)</span>
            <input className={inputCls} value={form.tagsInput} onChange={e => set('tagsInput', e.target.value)} placeholder="web, browser" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-fg-subtle">正文(load_skill 注入的内容)</span>
            <textarea className={inputCls + ' font-mono'} rows={14} value={form.body}
              onChange={e => set('body', e.target.value)} placeholder="# 技能正文…" />
          </label>
        </div>
      </div>
    </div>
  )
}
