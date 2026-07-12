import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Globe, RefreshCw, Link2, Link2Off, ListTree } from 'lucide-react'

export default function BrowserPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [port, setPort] = useState('9222')

  const run = useCallback(async (fn: () => Promise<{ text: string }>): Promise<void> => {
    setBusy(true)
    try { setOutput((await fn()).text) }
    catch (err) { setOutput('出错:' + (err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void run(() => window.wraith.browserStatus()) }, [run])

  const btn = 'flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="browser-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <Globe className="h-4 w-4 shrink-0" strokeWidth={1.5} />浏览器
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 panel-content">
        <div className="mb-3 rounded-lg border border-border bg-surface/40 px-3 py-2 text-3xs leading-relaxed text-fg-subtle">
          管理 agent 用哪个浏览器:<b className="text-fg-muted">隔离</b>(无痕、无登录态)↔ <b className="text-fg-muted">共享</b>(接管本机已登录 Chrome,可访问需登录页面)。
          <div className="mt-1">前置:① 本机 Chrome 以 <code className="text-fg">--remote-debugging-port=9222</code> 启动;② 「MCP」面板里配置了 <code className="text-fg">chrome-devtools</code>(npx 自动装)。未满足时连接会提示未配置。</div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className={btn} disabled={busy} onClick={() => void run(() => window.wraith.browserStatus())}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />刷新状态
          </button>
          <button className={btn} disabled={busy} onClick={() => void run(() => window.wraith.browserConnect())}>
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />连接(自动)
          </button>
          <span className="flex items-center gap-1">
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="端口"
              className="w-16 rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none" />
            <button className={btn} disabled={busy} onClick={() => void run(() => window.wraith.browserConnect(port))}>按端口连接</button>
          </span>
          <button className={btn} disabled={busy} onClick={() => void run(() => window.wraith.browserDisconnect())}>
            <Link2Off className="h-3.5 w-3.5" strokeWidth={1.5} />断开
          </button>
          <button className={btn} disabled={busy} onClick={() => void run(() => window.wraith.browserTabs())}>
            <ListTree className="h-3.5 w-3.5" strokeWidth={1.5} />标签页
          </button>
        </div>

        <pre className="min-h-24 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface/40 px-3 py-2 font-mono text-3xs leading-relaxed text-fg">
          {busy ? '执行中…' : (output || '(点上方按钮查看状态)')}
        </pre>
      </div>
    </div>
  )
}
