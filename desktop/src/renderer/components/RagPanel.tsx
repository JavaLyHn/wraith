import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ScanSearch, Database, Search, Network, Save, PlugZap } from 'lucide-react'
import type { EmbeddingConfigView, EmbeddingTestResult, RagScopeView, RagStatus, RagSearchItem, RagRelation, RagIndexResult } from '../../shared/types'
import { embeddingDefaults, staleIndexWarning, indexSummaryLines, relationHint,
  scopeMismatchWarning, scopeEffectNote, scopeSummaryLine } from '../lib/ragView'
import { embeddingTestLines, embeddingTestTone, embeddingTestToneClass, embeddingTestTitle, embeddingTestTitleClass } from '../lib/embeddingTestView'
import { parseIndexProgress, indexProgressView, indexCompositionBars } from '../lib/indexProgressView'
import type { IndexProgress } from '../lib/indexProgressView'

type Draft = { provider: string; model: string; baseUrl: string; apiKey: string }

export default function RagPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [emb, setEmb] = useState<EmbeddingConfigView | null>(null)
  const [draft, setDraft] = useState<Draft>({ provider: 'ollama', model: '', baseUrl: '', apiKey: '' })
  const [status, setStatus] = useState<RagStatus | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexProgress, setIndexProgress] = useState('')
  // 结构化进度 + 开始时刻。ETA 由渲染层自己计时算 —— 后端不带时间。
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [nowMs, setNowMs] = useState(0)
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
  // 索引范围。默认两个都关 = 行为与引入开关前一致。
  const [scope, setScope] = useState<RagScopeView>({ excludeTests: false, excludeDocs: false })
  // 后端支不支持范围设置。**get 失败就等于知道不支持** —— 那时必须把开关禁掉,
  // 否则用户点一下会吃到一句生的「method not found: config.setRagScope」。
  // 用户实测踩过这个:jar 是旧的,面板却让他点。
  const [scopeSupported, setScopeSupported] = useState(true)

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
  const loadScope = useCallback(async (): Promise<void> => {
    // 旧 jar 没有这条 RPC —— 拿不到就保持默认关、并**把开关禁掉**,不把面板整块打挂
    try {
      setScope(await window.wraith.configGetRagScope())
      setScopeSupported(true)
    } catch {
      setScopeSupported(false)
    }
  }, [])
  /** 勾选即写盘,但**不重建索引** —— 重建是一次整库扫描,不该由一次勾选触发。 */
  const saveScope = useCallback(async (next: RagScopeView): Promise<void> => {
    if (!scopeSupported) return   // 禁用态下不该发请求;这里再兜一层,防止绕过 disabled
    setScope(next)
    try {
      await window.wraith.configSetRagScope(next)
      // 重拉 status:范围不符提示要**立刻**出现,而不是等下次进面板
      void loadStatus()
    } catch (err) { setError((err as Error).message) }
  }, [loadStatus, scopeSupported])

  useEffect(() => { void loadCfg(); void loadStatus(); void loadScope() }, [loadCfg, loadStatus, loadScope])

  const stale = staleIndexWarning(status, emb?.model ?? '')
  const summaryLines = lastIndex ? indexSummaryLines(lastIndex) : []
  const relHint = lastIndex ? relationHint(lastIndex) : null
  const scopeStale = scopeMismatchWarning(status)
  const scopeLine = lastIndex ? scopeSummaryLine(lastIndex) : null
  const pv = progress ? indexProgressView({ ...progress, startedAtMs, nowMs }) : null
  const compBars = lastIndex ? indexCompositionBars(lastIndex) : []

  // 订阅索引实时进度(后端 CodeIndex.ProgressListener → writer.notify rag.index.progress)
  useEffect(() => {
    return window.wraith.onEvent((evt) => {
      if (evt.kind === 'notification' && evt.method === 'rag.index.progress') {
        const m = (evt.params as { message?: string })?.message
        if (typeof m === 'string') {
          setIndexProgress(m)
          // 事件只带 message 一个字符串,所以这里**解析显示串**取出进度。
          // 这个耦合是有意识的(见 indexProgressView.ts 的说明),Java 侧有
          // IndexProgressDetailTest#progressLineShapeIsParsedByDesktop 钉住格式:
          // 改那句进度文案会让那条测试变红。
          const parsed = parseIndexProgress(m)
          if (parsed) setProgress(parsed)
        }
      }
    })
  }, [])

  // 索引期间每秒推进一次 now,让「已用/剩余」是活的。**只在 indexBusy 时跑** ——
  // 常驻 timer 会让整个面板每秒重渲染一次。
  useEffect(() => {
    if (!indexBusy) return
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [indexBusy])

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
    setProgress({ phase: 'scanning' }); setStartedAtMs(Date.now()); setNowMs(Date.now())
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
    finally { setIndexBusy(false); setIndexProgress(''); setProgress(null) }
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

        {/* 2. 索引范围 */}
        <div className={sectionHead}>索引范围</div>
        <div className="mb-5">
          <label className={`flex items-center gap-2 text-xs ${scopeSupported ? 'cursor-pointer text-fg' : 'cursor-not-allowed text-fg-subtle'}`}>
            <input type="checkbox" data-testid="rag-scope-tests" checked={scope.excludeTests}
              disabled={!scopeSupported}
              onChange={(e) => void saveScope({ ...scope, excludeTests: e.target.checked })} />
            排除测试文件
          </label>
          <label className={`mt-1.5 flex items-center gap-2 text-xs ${scopeSupported ? 'cursor-pointer text-fg' : 'cursor-not-allowed text-fg-subtle'}`}>
            <input type="checkbox" data-testid="rag-scope-docs" checked={scope.excludeDocs}
              disabled={!scopeSupported}
              onChange={(e) => void saveScope({ ...scope, excludeDocs: e.target.checked })} />
            排除文档（.md / docs/，但保留 skills 下的 md）
          </label>
          {/* 后端旧了就说清怎么修,而不是让人点一下再看一句读不懂的 RPC 错误 */}
          {!scopeSupported && (
            <div data-testid="rag-scope-unsupported"
              className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-2xs leading-relaxed text-fg-muted">
              ⚠ 当前后端（jar）还不支持索引范围设置，开关已禁用。修法：重新打包
              <span className="font-mono"> mvn package </span>
              并把 <span className="font-mono">target/wraith-1.0-SNAPSHOT.jar</span> 覆盖到
              <span className="font-mono"> ~/.wraith/wraith.jar</span>，然后完全退出并重启桌面端。
            </div>
          )}
          {/* 两个开关效果**方向相反**,只写「可能影响检索质量」会让人以为「都勾上更干净」 */}
          <div className="mt-2 text-3xs leading-relaxed text-fg-subtle">{scopeEffectNote()}</div>
        </div>
        {/* 范围变了但模型没变时,staleIndexWarning 不会响 —— 它比的是模型 */}
        {scopeStale && (
          <div data-testid="rag-scope-stale"
            className="mb-5 -mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-2xs leading-relaxed text-fg-muted">
            ⚠ {scopeStale}
          </div>
        )}

        {/* 3. 索引 */}
        <div className={sectionHead}>索引</div>
        <div className="mb-5 flex items-center gap-3">
          <span className="text-xs text-fg-muted">
            {/* 重建期间不显示上一份索引的统计:那些数字属于**旧**索引,
                摆在实时进度旁边会被读成「已经索引了 9718 块」 */}
            {indexBusy
              ? (status?.indexed ? `上一份索引:${status.chunkCount} 块 · ${status.relationCount} 关系（正在重建）` : '正在建立索引…')
              : status?.error ? `状态未知(${status.error})` : status?.indexed ? `已索引 ${status.chunkCount} 块 · ${status.relationCount} 关系` : '未索引'}
          </span>
          <button onClick={() => void doIndex()} disabled={indexBusy}
            className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
            {indexBusy ? '索引中…' : status?.indexed ? '重建索引' : '建立索引'}
          </button>
        </div>
        {indexBusy && pv && (
          <div data-testid="rag-index-progress" className="mb-5 -mt-3">
            <div className="mb-1 flex items-baseline gap-2 text-2xs">
              <span className="font-bold text-fg">{pv.phaseLabel}</span>
              {pv.barPercent !== null && <span className="text-fg-muted">{pv.barPercent}%</span>}
              {pv.detail && <span className="text-fg-subtle">{pv.detail}</span>}
              <span className="ml-auto text-fg-subtle">
                已用 {pv.elapsedText}{pv.etaText ? ` · 剩余约 ${pv.etaText}` : ''}
                {pv.rateText ? ` · ${pv.rateText}` : ''}
              </span>
            </div>
            {/* 有总数就画确定宽度的条;前置阶段没有总数 → 走脉冲,不停在 0% 让人以为卡住 */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div data-testid="rag-index-bar"
                className={`h-full rounded-full bg-accent transition-[width] duration-500 ${pv.indeterminate ? 'animate-pulse' : ''}`}
                style={{ width: pv.indeterminate ? '100%' : `${pv.barPercent}%` }} />
            </div>
            {progress?.file && (
              <div className="mt-1 truncate font-mono text-3xs text-fg-subtle">刚完成 {progress.file}</div>
            )}
          </div>
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
            {/* 构成条:把范围开关的效果画出来 —— 光看「6283 块」看不出「排掉了 482 个测试文件」 */}
            {compBars.length > 1 && (
              <div data-testid="rag-index-composition" className="mt-2">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-border">
                  {compBars.map((b) => (
                    <div key={b.label} className={b.className} style={{ width: `${b.pct}%` }} title={b.label} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {compBars.map((b) => (
                    <span key={b.label} className="flex items-center gap-1 text-3xs text-fg-muted">
                      <span className={`inline-block h-2 w-2 rounded-sm ${b.className}`} />
                      {b.label}（{Math.round(b.pct)}%）
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 打开范围开关后块数会明显下降(9718→6283),不报会被读成索引出错 */}
            {scopeLine && (
              <div data-testid="rag-index-scope" className="mt-1 font-mono text-2xs text-fg-muted">{scopeLine}</div>
            )}
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
