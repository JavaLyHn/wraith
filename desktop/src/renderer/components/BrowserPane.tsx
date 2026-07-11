import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { normalizeUrl } from '../lib/rightDock'

/** Electron webview 元素的最小类型(仅用到的方法)。 */
interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
}

/** 内嵌浏览器:地址栏 + 前进/后退/刷新 + <webview>(独立 partition、隔离)。用户浏览用。 */
export default function BrowserPane({ active }: { active: boolean }): JSX.Element {
  void active // RightDock 通过 CSS 控制显隐;保留 prop 供将来扩展(如切走暂停媒体)
  const wv = useRef<WebviewEl | null>(null)
  const [addr, setAddr] = useState('')       // 地址栏输入
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // 绑定 webview DOM 事件(导航/加载态/失败)
  useEffect(() => {
    const el = wv.current
    if (!el) return
    const onStart = (): void => { setLoading(true); setFailed(false) }
    const onStop = (): void => { setLoading(false); try { setAddr(el.getURL()) } catch { /* ignore */ } }
    const onNav = (): void => { try { setAddr(el.getURL()) } catch { /* ignore */ } }
    const onFail = (e: Event): void => {
      // 主框架加载失败才标记(忽略子资源/-3 取消)
      const ev = e as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (ev.isMainFrame !== false && ev.errorCode !== -3) { setLoading(false); setFailed(true) }
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('did-fail-load', onFail as EventListener)
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('did-fail-load', onFail as EventListener)
    }
  }, [])

  const navigate = useCallback((raw: string) => {
    const url = normalizeUrl(raw)
    setFailed(false)
    void wv.current?.loadURL(url).catch(() => setFailed(true))
  }, [])

  const btn = 'rounded p-1 text-fg-muted hover:bg-surface/60 disabled:opacity-40'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 地址栏 + 导航 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <button className={btn} title="后退" onClick={() => wv.current?.goBack()}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="前进" onClick={() => wv.current?.goForward()}><ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button className={btn} title="刷新" onClick={() => wv.current?.reload()}><RotateCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} strokeWidth={1.5} /></button>
        <input
          data-testid="browser-addr"
          value={addr}
          onChange={e => setAddr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(addr) }}
          placeholder="输入网址回车访问"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-2xs text-fg outline-none focus:border-accent"
        />
      </div>
      {/* webview 主体 */}
      <div className="relative min-h-0 flex-1">
        {failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-xs text-fg-subtle">页面加载失败</div>
        )}
        {createElement('webview', {
          ref: wv,
          src: 'about:blank',
          partition: 'persist:wraith-browser',
          // 必须用 undefined(=不写该属性)来关弹窗;传 false 会渲染成 allowpopups="false" 字符串,
          // Electron 按"属性存在"判定反而开启弹窗。切勿改为 false。
          allowpopups: undefined,
          style: { width: '100%', height: '100%', display: 'flex' },
        })}
      </div>
    </div>
  )
}
