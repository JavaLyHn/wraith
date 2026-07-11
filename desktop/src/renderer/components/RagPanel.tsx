import { useCallback, useEffect, useState } from 'react'
import { ScanSearch, Database, Search, Network, Save } from 'lucide-react'
import type { EmbeddingConfigView, RagStatus, RagSearchItem, RagRelation } from '../../shared/types'
import { embeddingDefaults } from '../lib/ragView'

type Draft = { provider: string; model: string; baseUrl: string; apiKey: string }

export default function RagPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [emb, setEmb] = useState<EmbeddingConfigView | null>(null)
  const [draft, setDraft] = useState<Draft>({ provider: 'ollama', model: '', baseUrl: '', apiKey: '' })
  const [status, setStatus] = useState<RagStatus | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexProgress, setIndexProgress] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RagSearchItem[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [graphName, setGraphName] = useState('')
  const [relations, setRelations] = useState<RagRelation[] | null>(null)
  const [graphBusy, setGraphBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadCfg = useCallback(async (): Promise<void> => {
    try {
      const e = await window.wraith.configGetEmbedding()
      setEmb(e)
      setDraft({ provider: e.provider || 'ollama', model: e.model || '', baseUrl: e.baseUrl || '', apiKey: '' })
    } catch (err) { setError((err as Error).message) }
  }, [])
  const loadStatus = useCallback(async (): Promise<void> => {
    try { setStatus(await window.wraith.ragStatus()) } catch (err) { setError((err as Error).message) }
  }, [])

  useEffect(() => { void loadCfg(); void loadStatus() }, [loadCfg, loadStatus])

  // 订阅索引实时进度(后端 CodeIndex.ProgressListener → writer.notify rag.index.progress)
  useEffect(() => {
    return window.wraith.onEvent((evt) => {
      if (evt.kind === 'notification' && evt.method === 'rag.index.progress') {
        const m = (evt.params as { message?: string })?.message
        if (typeof m === 'string') setIndexProgress(m)
      }
    })
  }, [])

  const saveCfg = useCallback(async (): Promise<void> => {
    setNotice(null)
    try { await window.wraith.configSetEmbedding(draft); setNotice('✅ Embedding 配置已保存'); void loadCfg() }
    catch (err) { setError((err as Error).message) }
  }, [draft, loadCfg])

  const doIndex = useCallback(async (): Promise<void> => {
    setIndexBusy(true); setNotice(null); setError(null); setIndexProgress('')
    try {
      const r = await window.wraith.ragIndex()
      if (r.error) setError('索引失败:' + r.error)
      else setNotice(`✅ 已索引 ${r.chunkCount ?? 0} 块 · ${r.relationCount ?? 0} 关系`)
      void loadStatus()
    } catch (err) { setError((err as Error).message) }
    finally { setIndexBusy(false); setIndexProgress('') }
  }, [loadStatus])

  const doSearch = useCallback(async (): Promise<void> => {
    if (!query.trim()) return
    setSearchBusy(true); setError(null)
    try {
      const r = await window.wraith.ragSearch(query.trim())
      if (r.error) { setError('检索失败:' + r.error); setResults([]) } else setResults(r.results)
    } catch (err) { setError((err as Error).message) }
    finally { setSearchBusy(false) }
  }, [query])

  const doGraph = useCallback(async (): Promise<void> => {
    if (!graphName.trim()) return
    setGraphBusy(true); setError(null)
    try {
      const r = await window.wraith.ragGraph(graphName.trim())
      if (r.error) { setError('图谱查询失败:' + r.error); setRelations([]) } else setRelations(r.relations)
    } catch (err) { setError((err as Error).message) }
    finally { setGraphBusy(false) }
  }, [graphName])

  const ph = embeddingDefaults(draft.provider)
  const lbl = 'mb-1 block text-3xs uppercase tracking-wider text-fg-subtle'
  const inp = 'w-full rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-fg-subtle'
  const sectionHead = 'mb-2 flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="rag-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <ScanSearch className="h-4 w-4 shrink-0" strokeWidth={1.5} />代码检索
        </span>
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">{error}</div>}
      {notice && <div className="shrink-0 px-4 py-2 text-xs text-fg">{notice}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* 1. Embedding 后端 */}
        <div className={sectionHead}><Database className="h-3.5 w-3.5" strokeWidth={1.5} />Embedding 后端</div>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <div>
            <span className={lbl}>Provider</span>
            <select value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} className={inp}>
              <option value="ollama">ollama(本地)</option>
              <option value="zhipu">zhipu / GLM(云)</option>
              <option value="openai">openai 兼容(云)</option>
            </select>
          </div>
          <div>
            <span className={lbl}>Model</span>
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder={ph.model} className={inp} />
          </div>
          <div className="col-span-2">
            <span className={lbl}>Base URL</span>
            <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder={ph.baseUrl} className={inp} />
          </div>
          <div className="col-span-2">
            <span className={lbl}>API Key {emb?.hasKey && <span className="text-fg-subtle">· 已保存,留空=保留</span>}</span>
            <input type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder={draft.provider === 'ollama' ? '(本地 ollama 可留空)' : (emb?.hasKey ? '••••••••(留空保留)' : '')} className={inp} />
          </div>
          <div className="col-span-2">
            <button onClick={() => void saveCfg()} className="flex items-center gap-1.5 rounded-lg border border-accent px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
              <Save className="h-3.5 w-3.5" strokeWidth={1.5} />保存配置
            </button>
          </div>
        </div>

        {/* 2. 索引 */}
        <div className={sectionHead}>索引</div>
        <div className="mb-5 flex items-center gap-3">
          <span className="text-xs text-fg-muted">
            {status?.error ? `状态未知(${status.error})` : status?.indexed ? `已索引 ${status.chunkCount} 块 · ${status.relationCount} 关系` : '未索引'}
          </span>
          <button onClick={() => void doIndex()} disabled={indexBusy}
            className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
            {indexBusy ? '索引中…' : status?.indexed ? '重建索引' : '建立索引'}
          </button>
        </div>
        {indexBusy && (
          <div className="mb-5 -mt-3 truncate font-mono text-3xs text-fg-subtle">{indexProgress || '正在建立索引…(大库可能数分钟)'}</div>
        )}

        {/* 3. 检索 */}
        <div className={sectionHead}><Search className="h-3.5 w-3.5" strokeWidth={1.5} />语义检索</div>
        <div className="mb-2 flex items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doSearch() }}
            placeholder="按语义搜代码,如「用户登录实现」…" className={inp} />
          <button onClick={() => void doSearch()} disabled={searchBusy} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">搜索</button>
        </div>
        <div className="mb-5 flex flex-col gap-2">
          {results.map((r, i) => (
            <div key={r.filePath + i} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2 text-3xs text-fg-subtle">
                <span className="rounded bg-surface px-1.5 py-0.5">{r.chunkType}</span>
                <span className="font-medium text-fg">{r.name || r.filePath}</span>
                <span className="ml-auto">{r.similarity.toFixed(3)}</span>
              </div>
              <div className="mt-0.5 truncate text-3xs text-fg-subtle">{r.filePath}</div>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-3xs text-fg-muted">{r.content}</pre>
            </div>
          ))}
        </div>

        {/* 4. 图谱 */}
        <div className={sectionHead}><Network className="h-3.5 w-3.5" strokeWidth={1.5} />代码图谱</div>
        <div className="mb-2 flex items-center gap-2">
          <input value={graphName} onChange={(e) => setGraphName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doGraph() }}
            placeholder="类名 / 方法名,如 Main…" className={inp} />
          <button onClick={() => void doGraph()} disabled={graphBusy} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">查询</button>
        </div>
        {relations !== null && (
          relations.length === 0 ? <div className="text-3xs text-fg-subtle">无关系(先建索引,或换个名字)</div> : (
            <div className="flex flex-col gap-1 font-mono text-3xs text-fg-muted">
              {relations.map((rel, i) => (
                <div key={i}>{rel.fromName} ─[{rel.relationType}]→ {rel.toName || '?'}</div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
