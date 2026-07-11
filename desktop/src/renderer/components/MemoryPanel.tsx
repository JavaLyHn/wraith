import { useCallback, useEffect, useState } from 'react'
import { Brain, Search, Trash2, Plus, X, FileText } from 'lucide-react'
import type { MemoryEntryView } from '../../shared/types'
import { scopeLabel, relativeTime } from '../lib/memoryView'

export default function MemoryPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [entries, setEntries] = useState<MemoryEntryView[]>([])
  const [project, setProject] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [draftScope, setDraftScope] = useState<'project' | 'global'>('project')
  const [wraithMd, setWraithMd] = useState<{ exists: boolean; path: string }>({ exists: false, path: '' })
  const [initNotice, setInitNotice] = useState<string | null>(null)

  const load = useCallback(async (q?: string): Promise<void> => {
    setBusy(true)
    try {
      if (q && q.trim()) {
        const r = await window.wraith.memorySearch(q.trim())
        setEntries(r.entries); setProject(r.project); setError(null)
      } else {
        const r = await window.wraith.memoryList()
        setEntries(r.entries); setProject(r.project); setError(null)
        setWraithMd({ exists: !!r.wraithMdExists, path: r.wraithMdPath ?? '' })
      }
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  const doInitWraithMd = useCallback(async (): Promise<void> => {
    if (wraithMd.exists && !window.confirm('WRAITH.md 已存在,重写会覆盖当前内容(基于 README/AGENTS 重新生成)。继续?')) return
    setInitNotice(null)
    try {
      const r = await window.wraith.memoryInitProject(wraithMd.exists)
      setInitNotice((r.written ? '✅ ' : 'ℹ️ ') + r.message)
      void load()
    } catch (err) { setError((err as Error).message) }
  }, [wraithMd.exists, load])

  useEffect(() => { void load() }, [load])

  const clearSearch = useCallback((): void => { setQuery(''); void load() }, [load])

  const doDelete = useCallback(async (e: MemoryEntryView): Promise<void> => {
    if (!window.confirm(`删除这条${scopeLabel(e.scope)}记忆?\n\n${e.content.slice(0, 80)}`)) return
    try { await window.wraith.memoryDelete(e.id); void load(query) }
    catch (err) { setError((err as Error).message) }
  }, [load, query])

  const doSave = useCallback(async (): Promise<void> => {
    const fact = draft.trim()
    if (!fact) return
    try { await window.wraith.memorySave(fact, draftScope); setDraft(''); void load() }
    catch (err) { setError((err as Error).message) }
  }, [draft, draftScope, load])

  const doClearAll = useCallback(async (): Promise<void> => {
    if (!window.confirm('清空全部长期记忆?此操作不可撤销(项目 + 全局都会清)。')) return
    try { await window.wraith.memoryClear(); void load() }
    catch (err) { setError((err as Error).message) }
  }, [load])

  const now = Date.now()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="memory-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <Brain className="h-4 w-4 shrink-0" strokeWidth={1.5} />长期记忆
        </span>
        {project && <span className="ml-auto truncate text-xs text-fg-subtle">项目作用域:{project}</span>}
      </div>

      {/* 项目记忆 WRAITH.md */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
        <span className="shrink-0 text-xs text-fg-muted">项目记忆 WRAITH.md</span>
        <span className="min-w-0 flex-1 truncate text-3xs text-fg-subtle" title={wraithMd.path}>
          {wraithMd.exists ? `已生成 · ${wraithMd.path}` : '未生成(会注入 system prompt 的 Project Context)'}
        </span>
        <button onClick={() => void doInitWraithMd()}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">
          {wraithMd.exists ? '重写' : '生成'}
        </button>
      </div>
      {initNotice && <div className="shrink-0 px-4 py-1 text-3xs text-fg-subtle">{initNotice}</div>}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-2 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void load(query); if (e.key === 'Escape') clearSearch() }}
            placeholder="搜索记忆(回车)…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-fg-subtle" />
          {query && <button onClick={clearSearch} className="shrink-0 text-fg-subtle hover:text-fg"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>}
        </div>
        {entries.length > 0 && (
          <button data-testid="memory-clear-all" onClick={() => void doClearAll()} title="清空全部长期记忆"
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-danger hover:text-danger">清空</button>
        )}
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {busy && entries.length === 0 ? (
          <div className="text-xs text-fg-subtle">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-fg-subtle">暂无长期记忆。对话中 agent 会用 save_memory 自动记录,你也可在下方手动添加。</div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e) => (
              <div key={e.id} className="group flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-words text-xs text-fg">{e.content}</div>
                  <div className="mt-1 flex items-center gap-2 text-3xs text-fg-subtle">
                    <span className={'rounded px-1.5 py-0.5 ' + (e.scope === 'global' ? 'bg-accent/12 text-accent' : 'bg-surface text-fg-muted')}>{scopeLabel(e.scope)}</span>
                    <span>{relativeTime(e.timestampMs, now)}</span>
                  </div>
                </div>
                <button onClick={() => void doDelete(e)} title="删除"
                  className="shrink-0 rounded p-1 text-fg-subtle opacity-0 hover:bg-surface hover:text-danger group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
        <select value={draftScope} onChange={(e) => setDraftScope(e.target.value as 'project' | 'global')}
          className="shrink-0 rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-fg-muted">
          <option value="project">项目</option>
          <option value="global">全局</option>
        </select>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSave() }}
          placeholder="添加一条长期记忆(回车保存)…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-fg-subtle" />
        <button onClick={() => void doSave()} disabled={!draft.trim()}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-accent px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />保存
        </button>
      </div>
    </div>
  )
}
