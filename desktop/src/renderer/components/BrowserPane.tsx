import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, Plus, RotateCw } from 'lucide-react'
import BrowserWebview, { type WebviewEl } from './BrowserWebview'
import {
  addBrowserTab, closeBrowserTab, newBrowserTab, patchBrowserTab, setActiveBrowserTab,
  type BrowserTab, type BrowserTabsState,
} from '../lib/browserTabs'
import { normalizeUrl } from '../lib/rightDock'

/** 内嵌浏览器:多标签(每标签一个常挂 webview)+ 地址栏/导航 + 精致空态。用户浏览用。 */
export default function BrowserPane({ active }: { active: boolean }): JSX.Element {
  const [state, setState] = useState<BrowserTabsState>({ tabs: [], activeId: null })
  const [addr, setAddr] = useState('')
  const refs = useRef<Map<string, WebviewEl>>(new Map())
  const seq = useRef(0)
  const addrInput = useRef<HTMLInputElement>(null)

  const activeTab: BrowserTab | undefined = state.tabs.find(t => t.id === state.activeId)

  // 稳定回调:BrowserWebview 只在挂载时绑一次,靠这两个稳定引用
  const registerRef = useCallback((id: string, el: WebviewEl | null) => {
    if (el) refs.current.set(id, el)
    else refs.current.delete(id)
  }, [])
  const onState = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setState(s => patchBrowserTab(s, id, patch))
  }, [])

  const addNew = useCallback(() => {
    const id = 'btab-' + (++seq.current)
    setState(s => addBrowserTab(s, newBrowserTab(id)))
  }, [])

  // active 且无标签时自动建首标签(deps [active];关到空由 close 内部补,不靠此重建)
  useEffect(() => {
    if (active && state.tabs.length === 0) addNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 地址栏跟随活动标签:仅切标签或该标签真实导航(url 变)时回灌;
  // 用户打字只改本地 addr,不触发导航、也不被覆盖(activeTab.url 仅真实导航时变)
  useEffect(() => {
    setAddr(activeTab?.url ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeId, activeTab?.url])

  const close = (id: string): void => {
    refs.current.delete(id)
    const nid = 'btab-' + (++seq.current)   // 在 updater 外算 id(纯度:与 addNew 一致,避免 StrictMode 双调跳号)
    setState(s => {
      const ns = closeBrowserTab(s, id)
      return ns.tabs.length === 0 ? addBrowserTab(ns, newBrowserTab(nid)) : ns   // 关到空自动补新空白标签(永不空)
    })
  }

  const navigate = (raw: string): void => {
    const id = state.activeId
    if (!id) return
    const url = normalizeUrl(raw)
    setState(s => patchBrowserTab(s, id, { failed: false }))
    void refs.current.get(id)?.loadURL(url).catch(() => setState(s => patchBrowserTab(s, id, { failed: true })))
  }

  const btn = 'rounded p-1 text-fg-muted hover:bg-surface/60 disabled:opacity-40'
  const showEmpty = !!activeTab && activeTab.url === '' && !activeTab.loading && !activeTab.failed

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标签条 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <Globe className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <button data-testid="browser-tab" onClick={() => setState(s => setActiveBrowserTab(s, t.id))} className="max-w-[120px] truncate">{t.title}</button>
            <button data-testid="browser-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="browser-add" onClick={addNew} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建标签页"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* 工具条:后退/前进/刷新 + 地址栏 + 前往 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <button className={btn} title="后退" disabled={!activeTab?.canBack} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.goBack() }}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="前进" disabled={!activeTab?.canForward} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.goForward() }}><ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="刷新" disabled={!activeTab} onClick={() => { if (activeTab) refs.current.get(activeTab.id)?.reload() }}><RotateCw className={'h-3.5 w-3.5 ' + (activeTab?.loading ? 'animate-spin' : '')} strokeWidth={1.5} /></button>
        <input
          ref={addrInput}
          data-testid="browser-addr"
          value={addr}
          onChange={e => setAddr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(addr) }}
          placeholder="输入 URL"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-2xs text-fg outline-none focus:border-accent"
        />
        <button className={btn} title="前往" disabled={!activeTab} onClick={() => navigate(addr)}><ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* webview 栈(全常挂,CSS 显隐)+ 空态/失败态覆盖 */}
      <div className="relative min-h-0 flex-1">
        {state.tabs.map(t => (
          <BrowserWebview key={t.id} tab={t} active={t.id === state.activeId} onState={onState} registerRef={registerRef} />
        ))}
        {showEmpty && (
          <button
            data-testid="browser-empty"
            onClick={() => addrInput.current?.focus()}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg text-fg-subtle">
            <Globe className="h-16 w-16" strokeWidth={1} />
            <div className="text-sm font-semibold text-fg">开始浏览</div>
            <div className="text-xs text-fg-subtle">输入 URL 以打开页面</div>
          </button>
        )}
        {activeTab?.failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-xs text-fg-subtle">页面加载失败</div>
        )}
      </div>
    </div>
  )
}
