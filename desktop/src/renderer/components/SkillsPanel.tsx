import { useCallback, useEffect, useState } from 'react'
import type { SkillView } from '../../shared/types'
import { groupSkillsBySource } from '../lib/skillsView'

const SOURCE_BADGE: Record<SkillView['source'], string> = { builtin: '内置', user: '用户', project: '项目' }
const EMPTY_HINT: Record<SkillView['source'], string> = {
  builtin: '(无内置技能)',
  user: '把 SKILL.md 放到 ~/.wraith/skills/<名>/ 即可被加载',
  project: '把 SKILL.md 放到 <项目>/.wraith/skills/<名>/ 即可被加载',
}

export default function SkillsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const groups = groupSkillsBySource(skills)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="skills-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">技能</span>
        <span className="text-xs text-fg-subtle">SKILL.md 决策手册 · load_skill 注入</span>
        <button data-testid="skills-refresh" onClick={() => void refresh()} disabled={busy}
          className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent disabled:opacity-60">
          {busy ? '扫描中…' : '⟳ 重新扫描'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skills-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {skills.length === 0 && !busy && !error && (
          <div className="text-xs text-fg-subtle">还没有技能。把 SKILL.md 放到 ~/.wraith/skills/&lt;名&gt;/ 试试。</div>
        )}
        {groups.map(g => (
          <section key={g.source} className="mb-4">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {g.skills.map(s => (
                <div key={s.name} data-testid="skill-row"
                  className={'rounded-lg border border-border p-3 ' + (s.enabled ? '' : 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-fg">{s.name}</span>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] text-fg-subtle">{SOURCE_BADGE[s.source]}</span>
                    {(s.version || s.author) && (
                      <span className="shrink-0 text-[10px] text-fg-subtle">{[s.version, s.author].filter(Boolean).join(' · ')}</span>
                    )}
                    <button data-testid="skill-toggle" onClick={() => void toggle(s.name, !s.enabled)}
                      className="ml-auto shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">
                      {s.enabled ? '停用' : '启用'}
                    </button>
                  </div>
                  {s.description && <div className="mt-1 line-clamp-3 text-[11px] text-fg-muted">{s.description}</div>}
                  {s.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tags.map(t => <span key={t} className="rounded bg-surface/60 px-1.5 py-0.5 text-[10px] text-fg-subtle">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {skills.length > 0 && (['user', 'project'] as const).map(src =>
          groups.some(g => g.source === src) ? null : (
            <div key={src} className="mb-2 text-[11px] text-fg-subtle">{SOURCE_BADGE[src]}:{EMPTY_HINT[src]}</div>
          ),
        )}
      </div>
    </div>
  )
}
