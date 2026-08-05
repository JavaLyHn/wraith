import { useEffect, useState } from 'react'
import type { SearchStatusView, SearchTestResult } from '../../shared/types'

/**
 * 搜索后端配置表单 —— 长在「能力概览 → 网页搜索与抓取」卡片的详情里。
 *
 * <p>用户实测：那张卡片挂着黄色「需配置」，说明文字里写着「可用 `/config search` 写进配置」，
 * （注意别把那串写成 Markdown 粗体 —— `*` `*` `/` 三个字符会把这个块注释提前关掉，第一版就这样了）
 * 于是问「这个不是必须要 cli 才能配置吧 桌面端也可以 是不是哪里没做完整」。
 * <b>是没做完整</b>：`config.getSearch`（读）一直有，`config.setSearch`（写）整条链都不存在。
 *
 * <p>两条不显然的语义，与后端 `SearchConfigRules` 严格一致：
 * <ul>
 *   <li><b>API Key 框永不回填</b>（回包里根本没有 key），空着 = 不改。
 *       所以占位符必须说清「已保存·留空则不变」，否则用户以为它空了。</li>
 *   <li><b>换了后端就不继承旧 key</b>。`search` 节只有一个 apiKey 字段却服务智谱与 SerpAPI 两家；
 *       继承会把 SerpAPI 的 key 发给智谱。所以选了别家时，占位符要改口说「需要重新填」。</li>
 * </ul>
 */

interface Option {
  id: string
  name: string
  desc: string
  /** 需要填 API Key 吗 */
  needsKey: boolean
  /** 需要填实例地址吗 */
  needsUrl: boolean
  warn?: string
}

/** 顺序刻意把「免费无需 key」放在最前 —— 那是门槛最低的一条路。 */
export const SEARCH_BACKENDS: Option[] = [
  {
    id: 'searxng', name: 'SearXNG', desc: '自托管开源元搜索，免费且无需 key',
    needsKey: false, needsUrl: true,
  },
  {
    id: 'zhipu', name: '智谱 GLM', desc: '与 GLM 推理共用同一个 key',
    needsKey: true, needsUrl: false,
  },
  {
    id: 'serpapi', name: 'SerpAPI', desc: '商业聚合 API，付费即开即用',
    needsKey: true, needsUrl: false,
  },
  {
    id: 'duckduckgo', name: 'DuckDuckGo', desc: '零 key 应急方案',
    needsKey: false, needsUrl: false,
    warn: '靠抓 HTML 页面，对方改版或限流就会失效，只建议临时用',
  },
]

interface Props {
  /** 当前状态；null = 还没拿到 */
  status: SearchStatusView | null
  onSaved: () => void
}

export default function SearchBackendForm({ status, onSaved }: Props): JSX.Element {
  const savedProvider = (status?.savedProvider ?? '').toLowerCase()
  const [provider, setProvider] = useState(savedProvider)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<SearchTestResult | null>(null)

  // status 迟到时补上初值(进面板是先渲染再拉状态的)。只在用户还没动过表单时补,
  // 否则会把正在输入的内容冲掉。
  useEffect(() => {
    if (!status) return
    setProvider(p => (p === '' ? (status.savedProvider ?? '').toLowerCase() : p))
    setBaseUrl(u => (u === '' ? (status.baseUrl ?? '') : u))
  }, [status])

  const option = SEARCH_BACKENDS.find(o => o.id === provider) ?? null
  const providerUnchanged = provider !== '' && provider === savedProvider
  // 已存的 key 只有在「还是同一家」时才继续有效 —— 换家不继承(后端同此语义)
  const inheritsKey = Boolean(status?.hasKey) && providerUnchanged

  const keyPlaceholder = inheritsKey ? '已保存 · 留空则不变' : '粘贴 API Key'
  const canSubmit = option !== null && !busy
      && !(option.needsUrl && baseUrl.trim() === '')
      && !(option.needsKey && !inheritsKey && apiKey.trim() === '')

  const draft = () => ({ provider, apiKey, baseUrl: option?.needsUrl ? baseUrl : '' })

  async function save(): Promise<void> {
    setBusy(true); setError(null); setSaved(false); setTest(null)
    try {
      const res = await window.wraith.configSetSearch(draft())
      if (res?.ok) {
        setSaved(true)
        setApiKey('')          // 存完就丢掉草稿里的 key,不留在渲染进程内存里
        onSaved()
      } else {
        setError(res?.error ?? '保存失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function runTest(): Promise<void> {
    setBusy(true); setError(null); setSaved(false); setTest(null)
    try {
      setTest(await window.wraith.configTestSearch(draft()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="search-backend-form" className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="text-xs font-medium text-fg">配置搜索后端</div>

      <div className="flex flex-col gap-1.5">
        {SEARCH_BACKENDS.map(o => (
          <label key={o.id} data-testid={`search-backend-option-${o.id}`}
            className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface/60">
            <input type="radio" name="search-backend" value={o.id} checked={provider === o.id}
              onChange={() => { setProvider(o.id); setTest(null); setSaved(false); setError(null) }}
              className="mt-0.5" />
            <span className="min-w-0">
              <span className="text-xs text-fg">{o.name}</span>
              {o.id === savedProvider && (
                <span className="ml-1.5 rounded bg-surface px-1 py-0.5 text-4xs text-fg-subtle">当前</span>
              )}
              <span className="block text-2xs text-fg-muted">{o.desc}</span>
              {o.warn && <span className="block text-2xs text-warn/90">{o.warn}</span>}
            </span>
          </label>
        ))}
      </div>

      {option?.needsUrl && (
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-fg-subtle">实例地址</span>
          <input data-testid="search-backend-baseurl" value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:8888"
            className="rounded-lg border border-border bg-surface/40 px-2 py-1 font-mono text-xs text-fg" />
        </label>
      )}

      {option?.needsKey && (
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-fg-subtle">API Key</span>
          <input data-testid="search-backend-apikey" type="password" value={apiKey}
            onChange={e => setApiKey(e.target.value)} placeholder={keyPlaceholder}
            className="rounded-lg border border-border bg-surface/40 px-2 py-1 font-mono text-xs text-fg" />
          {!inheritsKey && Boolean(status?.hasKey) && (
            <span data-testid="search-backend-key-not-inherited" className="text-2xs text-warn/90">
              换了后端，已保存的 key 不会沿用（一个 key 字段服务两家，沿用会发错家）——请重新填。
            </span>
          )}
        </label>
      )}

      <div className="flex items-center gap-2">
        <button data-testid="search-backend-test" disabled={!canSubmit} onClick={() => void runTest()}
          className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50">
          测试连接
        </button>
        <button data-testid="search-backend-save" disabled={!canSubmit} onClick={() => void save()}
          className="rounded-lg border border-accent px-2 py-1 text-2xs text-accent hover:bg-accent/10 disabled:opacity-50">
          保存
        </button>
        {busy && <span className="text-2xs text-fg-subtle">进行中…</span>}
      </div>

      {saved && (
        <div data-testid="search-backend-saved" className="text-2xs text-ok">
          已保存，立即生效（不用重启）
        </div>
      )}
      {error && (
        <div data-testid="search-backend-error" className="select-text rounded-lg bg-danger/10 px-2 py-1.5 text-2xs text-danger">
          {error}
        </div>
      )}
      {test && (
        <div data-testid="search-backend-test-result"
          className={'select-text rounded-lg px-2 py-1.5 text-2xs '
            + (test.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger')}>
          {test.ok ? (
            <>连接正常 · 返回 {test.results} 条 · {test.latencyMs}ms
              {test.sample && <span className="block text-fg-muted">首条：{test.sample}</span>}
            </>
          ) : (
            <>{test.error ?? '测试失败'}</>
          )}
        </div>
      )}
    </div>
  )
}
