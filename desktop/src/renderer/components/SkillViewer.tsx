import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { SkillDetail } from '../../shared/types'

const SOURCE_BADGE: Record<SkillDetail['source'], string> = { builtin: '内置', user: '用户', project: '项目' }

/** 技能只读查看:元信息 + SKILL.md 正文 + references/ 参考文件(可展开)。 */
export default function SkillViewer({ detail, onBack }: { detail: SkillDetail; onBack: () => void }): JSX.Element {
  const refs = detail.references ?? []
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const meta = [detail.version, detail.author].filter(Boolean).join(' · ')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="skill-view-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回技能</button>
        <span className="truncate text-sm font-bold text-fg">{detail.name}</span>
        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">{SOURCE_BADGE[detail.source]}</span>
        {meta && <span className="shrink-0 text-3xs text-fg-subtle">{meta}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {detail.description && <p className="mb-3 text-2xs text-fg-muted">{detail.description}</p>}
        {detail.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {detail.tags.map(t => <span key={t} className="rounded bg-surface/60 px-1.5 py-0.5 text-3xs text-fg-subtle">{t}</span>)}
          </div>
        )}

        <div className="mb-1 text-3xs uppercase tracking-wider text-fg-subtle">SKILL.md</div>
        <pre className="mb-4 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-elevated p-3 font-mono text-2xs leading-relaxed text-fg">{detail.body || '(空)'}</pre>

        {refs.length > 0 && (
          <>
            <div className="mb-1 text-3xs uppercase tracking-wider text-fg-subtle">参考资料 · references/ ({refs.length})</div>
            <div className="flex flex-col gap-1.5">
              {refs.map(r => (
                <div key={r.path} data-testid="skill-ref" className="rounded-lg border border-border">
                  <button
                    onClick={() => setOpen(o => ({ ...o, [r.path]: !o[r.path] }))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-2xs text-fg hover:bg-surface/60"
                  >
                    {open[r.path] ? <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
                    <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
                    <span className="truncate font-mono">{r.path}</span>
                  </button>
                  {open[r.path] && (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-border bg-bg-elevated p-3 font-mono text-3xs leading-relaxed text-fg-muted">{r.content}</pre>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
