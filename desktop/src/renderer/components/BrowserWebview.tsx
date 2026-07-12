import { createElement, useEffect, useRef } from 'react'
import type { BrowserTab } from '../lib/browserTabs'
import { fitZoom } from '../lib/rightDock'

/** Electron webview 元素的最小类型(仅用到的方法)。 */
export interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  setZoomFactor(factor: number): void
}

const displayUrl = (u: string): string => (u === 'about:blank' ? '' : u)

/** 单个标签的内嵌 webview:绑导航/加载/标题/失败事件经 onState(id,patch) 上抛;
 * 挂载时把 DOM ref 注册给父层(供工具条驱动导航),卸载置 null;!active 时 CSS 隐藏、常挂不销毁。 */
export default function BrowserWebview(
  { tab, active, onState, registerRef }:
  { tab: BrowserTab; active: boolean; onState: (id: string, patch: Partial<BrowserTab>) => void; registerRef: (id: string, el: WebviewEl | null) => void },
): JSX.Element {
  const wv = useRef<WebviewEl | null>(null)
  const id = tab.id

  useEffect(() => {
    const el = wv.current
    if (!el) return
    registerRef(id, el)
    // 自动缩放适宽:按面板实宽算缩放因子,让宽桌面站(如百度 PC 版)以 ~1000px 桌面宽布局再缩放填满面板,
    // 不裁切;面板≥目标宽则 z=1 不缩。dom-ready(每次导航就绪)+ 面板尺寸变化时重applied。
    const applyFit = (): void => {
      try { el.setZoomFactor(fitZoom(el.getBoundingClientRect().width)) } catch { /* 未就绪:忽略,dom-ready/resize 会再试 */ }
    }
    el.addEventListener('dom-ready', applyFit)
    const ro = new ResizeObserver(applyFit)
    ro.observe(el)
    const onStart = (): void => onState(id, { loading: true, failed: false })
    const onStop = (): void => {
      try { onState(id, { loading: false, url: displayUrl(el.getURL()), title: el.getTitle() || '新标签页', canBack: el.canGoBack(), canForward: el.canGoForward() }) }
      catch { onState(id, { loading: false }) }
    }
    const onNav = (): void => {
      try { onState(id, { url: displayUrl(el.getURL()), canBack: el.canGoBack(), canForward: el.canGoForward() }) } catch { /* ignore */ }
    }
    const onTitle = (e: Event): void => {
      const ev = e as unknown as { title?: string }
      onState(id, { title: ev.title || '新标签页' })
    }
    const onFail = (e: Event): void => {
      // 仅主框架失败才标记(忽略子资源 / -3 用户取消)
      const ev = e as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (ev.isMainFrame !== false && ev.errorCode !== -3) onState(id, { loading: false, failed: true })
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('page-title-updated', onTitle as EventListener)
    el.addEventListener('did-fail-load', onFail as EventListener)
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('page-title-updated', onTitle as EventListener)
      el.removeEventListener('did-fail-load', onFail as EventListener)
      el.removeEventListener('dom-ready', applyFit)
      ro.disconnect()
      registerRef(id, null)
    }
    // 仅按标签 id 绑一次;onState/registerRef 由父层 useCallback 稳定,故不入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className={'absolute inset-0 ' + (active ? '' : 'hidden')}>
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
  )
}
