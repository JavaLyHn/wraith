import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Brain, Search, Trash2, Plus, X, FileText, Check, RotateCcw } from 'lucide-react'
import type { MemoryEntryView, PendingFactView } from '../../shared/types'
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

  const [pending, setPending] = useState<PendingFactView[]>([])

  const loadPending = useCallback(async (): Promise<void> => {
    try {
      const r = await window.wraith.memoryPendingList()
      setPending(r.pending)
    } catch (err) { setError((err as Error).message) }
  }, [])

  const doExtractNow = useCallback(async (): Promise<void> => {
    setBusy(true); setInitNotice(null)
    try {
      const r = await window.wraith.memoryExtractNow()
      setInitNotice(r.enqueued > 0 ? `🧠 已从本次对话抽取 ${r.enqueued} 条候选,请在下方待确认区复核` : 'ℹ️ 本次对话没有可沉淀的新事实')
      await loadPending()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [loadPending])

  const doApprove = useCallback(async (f: PendingFactView): Promise<void> => {
    setInitNotice(null)
    try {
      const r = await window.wraith.memoryPendingApprove(f.id)
      if (!r.ok) { setInitNotice('⚠️ 批准未生效(可能已处理或非当前项目可见)'); return }
      await loadPending(); void load(query)
    } catch (err) { setError((err as Error).message) }
  }, [loadPending, load, query])

  const doReplace = useCallback(async (f: PendingFactView): Promise<void> => {
    if (!f.nearestExistingId) return
    setInitNotice(null)
    try {
      const r = await window.wraith.memoryPendingApproveReplacing(f.id, f.nearestExistingId)
      if (!r.ok) { setInitNotice('⚠️ 替换未生效(旧条不存在/不可见,或候选已处理)'); return }
      await loadPending(); void load(query)
    } catch (err) { setError((err as Error).message) }
  }, [loadPending, load, query])

  const doReject = useCallback(async (f: PendingFactView): Promise<void> => {
    setInitNotice(null)
    try {
      const r = await window.wraith.memoryPendingReject(f.id)
      if (!r.ok) { setInitNotice('⚠️ 驳回未生效(可能已处理或非当前项目可见)'); return }
      await loadPending()
    } catch (err) { setError((err as Error).message) }
  }, [loadPending])

  const doClearPending = useCallback(async (): Promise<void> => {
    if (!window.confirm('清空全部待确认候选?(不影响已入库的长期记忆)')) return
    try { await window.wraith.memoryPendingClear(); await loadPending() }
    catch (err) { setError((err as Error).message) }
  }, [loadPending])

  useEffect(() => { void load() }, [load])

  useEffect(() => { void loadPending() }, [loadPending])

  const clearSearch = useCallback((): void => { setQuery(''); void load() }, [load])

  const doDelete = useCallback(async (e: MemoryEntryView): Promise<void> => {
    if (!window.confirm(`删除这条${scopeLabel(e.scope)}记忆?\n\n${e.content.slice(0, 80)}`)) return
    try { await window.wraith.memoryDelete(e.id); void load(query) }
    catch (err) { setError((err as Error).message) }
  }, [load, query])

  const doSave = useCallback(async (): Promise<void> => {
    const fact = draft.trim()
    if (!fact) return
    try {
      const r = await window.wraith.memorySave(fact, draftScope)
      if (!r.ok) { setInitNotice('🚫 拒绝保存:疑似凭证(密码/密钥等),未写入长期记忆'); return }
      setDraft(''); void load()
    }
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
        <button data-testid="memory-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
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
        <button data-testid="memory-extract-now" onClick={() => void doExtractNow()} disabled={busy} title="扫描本次对话,把稳定事实提为待确认候选(不清空对话)"
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">整理记忆</button>
        {entries.length > 0 && (
          <button data-testid="memory-clear-all" onClick={() => void doClearAll()} title="清空全部长期记忆"
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-danger hover:text-danger">清空</button>
        )}
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 panel-content">
        {pending.length > 0 && (
          <div data-testid="memory-pending-section" className="mb-3 rounded-lg border border-warn/40 bg-warn/5 p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-warn">📥 待确认候选 ({pending.length})</span>
              <button data-testid="memory-pending-clear" onClick={() => void doClearPending()}
                className="ml-auto text-3xs text-fg-subtle hover:text-danger">清空</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {pending.map((f) => (
                <div key={f.id} data-testid="memory-pending-item" className="rounded-lg border border-border bg-bg px-2.5 py-1.5">
                  <div className="whitespace-pre-wrap break-words text-xs text-fg">{f.fact}</div>
                  <div className="mt-1 flex items-center gap-2 text-3xs text-fg-subtle">
                    <span className={'rounded px-1.5 py-0.5 ' + (f.scope === 'global' ? 'bg-accent/12 text-accent' : 'bg-surface text-fg-muted')}>{scopeLabel(f.scope)}</span>
                    {f.nearestExistingId && <span title={f.nearestExistingId}>↔ 相似既有条</span>}
                    <span className="ml-auto flex items-center gap-1">
                      <button data-testid={`pending-approve-${f.id}`} onClick={() => void doApprove(f)} title="批准入库"
                        className="flex items-center gap-0.5 rounded border border-ok/50 px-1.5 py-0.5 text-ok hover:bg-ok/10"><Check className="h-3 w-3" strokeWidth={2} />批准</button>
                      {f.nearestExistingId && (
                        <button data-testid={`pending-replace-${f.id}`} onClick={() => void doReplace(f)} title="批准并替换相似旧条"
                          className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-fg-muted hover:border-accent hover:text-accent"><RotateCcw className="h-3 w-3" strokeWidth={1.5} />替换</button>
                      )}
                      <button data-testid={`pending-reject-${f.id}`} onClick={() => void doReject(f)} title="驳回"
                        className="rounded border border-border px-1.5 py-0.5 text-fg-subtle hover:border-danger hover:text-danger">驳回</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
