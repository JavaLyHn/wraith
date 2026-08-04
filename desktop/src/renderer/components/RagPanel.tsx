import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ScanSearch, Database, Search, Network, Save, PlugZap } from 'lucide-react'
import type { EmbeddingConfigView, EmbeddingTestResult, RagStatus, RagSearchItem, RagRelation, RagIndexResult } from '../../shared/types'
import { embeddingDefaults, staleIndexWarning, indexSummaryLines, relationHint } from '../lib/ragView'
import { embeddingTestLines, embeddingTestTone, embeddingTestToneClass, embeddingTestTitle, embeddingTestTitleClass } from '../lib/embeddingTestView'

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
  // 上一次索引的明细。此前建完只留一句「已索引 N 块 · M 关系」——用户原话「没有结果展示」。
  const [lastIndex, setLastIndex] = useState<RagIndexResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 「测试连接」的结果。与 notice/error 分开放:它有自己的三态(通了 / 通了但不兼容 / 没通),
  // 而且要一直挂在表单下面 —— 边改边测时上一次的结论还得看得见。
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null)
  const [testBusy, setTestBusy] = useState(false)

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

  const stale = staleIndexWarning(status, emb?.model ?? '')
  const summaryLines = lastIndex ? indexSummaryLines(lastIndex) : []
  const relHint = lastIndex ? relationHint(lastIndex) : null

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
    try {
      await window.wraith.configSetEmbedding(draft)
      setNotice('✅ Embedding 配置已保存')
      void loadCfg()
      // 也要重拉 status:换了模型的话「索引是旧模型建的」提示应当**立刻**出现,
      // 而不是等下次进面板 —— 那期间用户已经去检索并拿到一堆 0 分结果了。
      void loadStatus()
    }
    catch (err) { setError((err as Error).message) }
  }, [draft, loadCfg, loadStatus])

  /**
   * 用**表单草稿**发一次真实 embedding 请求。刻意不写盘 —— 点测试就把一份没验过的配置
   * 存进 config.json 是另一回事。apiKey 留空时后端沿用已存的那个（与保存同语义），
   * 否则云端后端永远测出 401:KEY 框从不回填已存 key。
   */
  const testCfg = useCallback(async (): Promise<void> => {
    setTestBusy(true); setTestResult(null); setNotice(null); setError(null)
    try {
      setTestResult(await window.wraith.configTestEmbedding(draft))
    } catch (err) {
      // RPC 层自己挂了(旧 jar 没有 config.testEmbedding)也要落到界面上,不能静默
      setError((err as Error).message)
    } finally { setTestBusy(false) }
  }, [draft])

  const doIndex = useCallback(async (): Promise<void> => {
    setIndexBusy(true); setNotice(null); setError(null); setIndexProgress('')
    try {
      const r = await window.wraith.ragIndex()
      setLastIndex(r.error ? null : r)
      if (r.error) setError('索引失败:' + r.error)
      else if ((r.failedChunks ?? 0) > 0) {
        // 残缺索引不能只报成功数:那会让人以为搜得全,其实有一批代码永远搜不到
        setError(`索引不完整:成功 ${r.chunkCount ?? 0} 块,${r.failedChunks} 块失败`
          + `(涉及 ${r.failedFiles ?? 0} 个文件)。${r.message ?? ''}`)
      } else setNotice('✅ 索引完成')
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
        <button data-testid="rag-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <ScanSearch className="h-4 w-4 shrink-0" strokeWidth={1.5} />代码检索
        </span>
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">{error}</div>}
      {notice && <div className="shrink-0 px-4 py-2 text-xs text-fg">{notice}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 panel-content">
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
          <div className="col-span-2 flex items-center gap-2">
            <button onClick={() => void saveCfg()} className="flex items-center gap-1.5 rounded-lg border border-accent px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
              <Save className="h-3.5 w-3.5" strokeWidth={1.5} />保存配置
            </button>
            {/* 此前验证后端唯一的办法是点「建立索引」—— 上千个代码块的整库扫描。
                配错一个字符就得等它跑完,或者盯着一句 OkHttp 原文猜。 */}
            <button data-testid="rag-test-embedding" onClick={() => void testCfg()} disabled={testBusy}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
              <PlugZap className={`h-3.5 w-3.5 ${testBusy ? 'inline-block animate-pulse' : ''}`} strokeWidth={1.5} />
              {testBusy ? '测试中…' : '测试连接'}
            </button>
          </div>
          {/* 结果三态:通了 / 通了但与现有索引不兼容 / 没通。第二态不能混进第一态 ——
              给个绿勾加一行小字,用户只会看见绿勾。 */}
          {testResult && (
            <div data-testid="rag-embedding-test-result"
              className={`col-span-2 rounded-lg border px-3 py-2 ${embeddingTestToneClass(embeddingTestTone(testResult))}`}>
              <div className={`mb-1 text-2xs font-bold ${embeddingTestTitleClass(embeddingTestTone(testResult))}`}>
                {embeddingTestTitle(embeddingTestTone(testResult))}
              </div>
              <div className="flex flex-col gap-0.5">
                {/* 明细行走**正文令牌**而不是 tone 色:tone 色压在 tone/10 底上亮色主题
                    只有 2.4~2.9:1(量过),text-fg-muted 是 4.9~5.2:1。也不加 opacity ——
                    那是把刚调够的对比度再压回去。break-words 而非 break-all,
                    后者会把中文句子在任意字符处切断。 */}
                {embeddingTestLines(testResult).map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-fg-muted">{l}</div>
                ))}
              </div>
            </div>
          )}
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
        {/* 建完之后的明细。此前只有一句「已索引 N 块 · M 关系」,说不出索引了什么。 */}
        {!indexBusy && lastIndex && summaryLines.length > 0 && (
          <div data-testid="rag-index-summary" className="mb-5 -mt-3 rounded-lg border border-border bg-surface/40 px-3 py-2">
            <div className="mb-1 text-3xs uppercase tracking-wider text-fg-subtle">本次索引</div>
            <div className="flex flex-col gap-0.5">
              {summaryLines.map((l) => (
                <div key={l} className="font-mono text-2xs text-fg-muted">{l}</div>
              ))}
            </div>
            {/* 「0 关系」要么解释成正常(非 Java 项目),要么说成异常(有 Java 却 0 条) */}
            {relHint && <div className="mt-1.5 text-2xs leading-relaxed text-fg-subtle">{relHint}</div>}
          </div>
        )}

        {/* 索引是旧模型建的:比的是**已保存**的 emb.model,不是 draft.model ——
            用户正在输入框里打字的中间态不该触发警告。
            正文用 text-fg-muted 而不是 text-warn:后者压在 bg-warn/10 上亮色主题只有
            2.44:1(量过,正文要 ≥4.5:1)。状态由描边 + 底色 + ⚠ 承载,不靠文字颜色。 */}
        {!indexBusy && stale && (
          <div data-testid="rag-stale-index"
            className="mb-5 -mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-2xs leading-relaxed text-fg-muted">
            ⚠ {stale}
          </div>
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
