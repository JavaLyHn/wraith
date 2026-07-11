import { useCallback, useEffect, useState } from 'react'
import type { SkillView, SkillDetail } from '../../shared/types'
import { groupSkillsBySource } from '../lib/skillsView'
import SkillEditor from './SkillEditor'
import SkillViewer from './SkillViewer'

const SOURCE_BADGE: Record<SkillView['source'], string> = { builtin: '内置', user: '用户', project: '项目' }
const EMPTY_HINT: Record<SkillView['source'], string> = {
  builtin: '(无内置技能)',
  user: '把 SKILL.md 放到 ~/.wraith/skills/<名>/ 即可被加载',
  project: '把 SKILL.md 放到 <项目>/.wraith/skills/<名>/ 即可被加载',
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; detail: SkillDetail } | { kind: 'view'; detail: SkillDetail }

export default function SkillsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try { const r = await window.wraith.skillsList(); setSkills(r.skills); setError(null) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = useCallback(async (name: string, enabled: boolean): Promise<void> => {
    setSkills(prev => prev.map(s => (s.name === name ? { ...s, enabled } : s)))  // 乐观更新
    try { await window.wraith.setSkillEnabled(name, enabled); void refresh() }
    catch (err) { setError((err as Error).message); void refresh() }
  }, [refresh])

  const openEdit = useCallback(async (name: string): Promise<void> => {
    try { const detail = await window.wraith.getSkill(name); setMode({ kind: 'edit', detail }) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const openView = useCallback(async (name: string): Promise<void> => {
    try { const detail = await window.wraith.getSkill(name); setMode({ kind: 'view', detail }) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const doDelete = useCallback(async (s: SkillView): Promise<void> => {
    if (s.source === 'builtin') return
    if (!window.confirm(`删除技能「${s.name}」?此操作不可撤销。`)) return
    try { await window.wraith.deleteSkill(s.source, s.name); void refresh() }
    catch (err) { setError((err as Error).message) }
  }, [refresh])

  const doFork = useCallback(async (s: SkillView): Promise<void> => {
    const exists = skills.some(x => x.source === 'user' && x.name === s.name)
    if (exists && !window.confirm(`用户技能「${s.name}」已存在,覆盖?`)) return
    try { await window.wraith.forkSkill(s.name); void refresh() }
    catch (err) { setError((err as Error).message) }
  }, [refresh, skills])

  if (mode.kind === 'new') {
    return <SkillEditor lockName={false} lockScope={false}
      onSaved={() => { setMode({ kind: 'list' }); void refresh() }}
      onCancel={() => setMode({ kind: 'list' })} />
  }
  if (mode.kind === 'edit') {
    return <SkillEditor initial={mode.detail} lockName lockScope={false}
      onSaved={() => { setMode({ kind: 'list' }); void refresh() }}
      onCancel={() => setMode({ kind: 'list' })} />
  }
  if (mode.kind === 'view') {
    return <SkillViewer detail={mode.detail} onBack={() => setMode({ kind: 'list' })} />
  }

  const groups = groupSkillsBySource(skills)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="skills-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">技能</span>
        <span className="text-xs text-fg-subtle">SKILL.md 决策手册 · load_skill 注入</span>
        <div className="ml-auto flex items-center gap-2">
          <button data-testid="skills-new" onClick={() => setMode({ kind: 'new' })}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10">＋ 新建技能</button>
          <button data-testid="skills-refresh" onClick={() => void refresh()} disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent disabled:opacity-60">
            {busy ? '扫描中…' : '⟳ 重新扫描'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skills-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {skills.length === 0 && !busy && !error && (
          <div className="text-xs text-fg-subtle">还没有技能。点「＋ 新建技能」或把 SKILL.md 放到 ~/.wraith/skills/&lt;名&gt;/。</div>
        )}
        {groups.map(g => (
          <section key={g.source} className="mb-4">
            <div className="mb-1 text-3xs uppercase tracking-wider text-fg-subtle">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {g.skills.map(s => (
                <div key={s.name} data-testid="skill-row"
                  className={'rounded-lg border border-border p-3 ' + (s.enabled ? '' : 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-fg">{s.name}</span>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">{SOURCE_BADGE[s.source]}</span>
                    {(s.version || s.author) && (
                      <span className="shrink-0 text-3xs text-fg-subtle">{[s.version, s.author].filter(Boolean).join(' · ')}</span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <button data-testid="skill-view" onClick={() => void openView(s.name)}
                        className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent">查看</button>
                      {s.source === 'builtin' ? (
                        <button data-testid="skill-fork" onClick={() => void doFork(s)}
                          className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent">复制为用户技能</button>
                      ) : (
                        <>
                          <button data-testid="skill-edit" onClick={() => void openEdit(s.name)}
                            className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent">编辑</button>
                          <button data-testid="skill-delete" onClick={() => void doDelete(s)}
                            className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-danger hover:text-danger">删除</button>
                        </>
                      )}
                      <button data-testid="skill-toggle" onClick={() => void toggle(s.name, !s.enabled)}
                        className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent">
                        {s.enabled ? '停用' : '启用'}
                      </button>
                    </div>
                  </div>
                  {s.description && <div className="mt-1 line-clamp-3 text-2xs text-fg-muted">{s.description}</div>}
                  {s.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tags.map(t => <span key={t} className="rounded bg-surface/60 px-1.5 py-0.5 text-3xs text-fg-subtle">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {skills.length > 0 && (['user', 'project'] as const).map(src =>
          groups.some(g => g.source === src) ? null : (
            <div key={src} className="mb-2 text-2xs text-fg-subtle">{SOURCE_BADGE[src]}:{EMPTY_HINT[src]}</div>
          ),
        )}
      </div>
    </div>
  )
}
