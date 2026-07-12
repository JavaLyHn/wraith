import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ShieldCheck, RefreshCw } from 'lucide-react'
import type { PolicyStatusView, AuditEntryView, SandboxState } from '../../shared/types'
import { outcomeLabel, approverLabel, formatAuditTime } from '../lib/policyView'

const FIXED_POLICY = [
  '路径围栏:read_file / write_file / list_dir / create_project 强制限定在项目根内',
  '命令黑名单:sudo、rm -rf 全盘、mkfs、dd of=/dev、fork bomb、curl|sh、chmod 777 /、shutdown 等',
  '写入文件上限 5MB;命令执行上限 60 秒、输出 8KB(截断)',
]

function outcomeClass(outcome: string): string {
  if (outcome === 'deny') return 'bg-danger/12 text-danger'
  if (outcome === 'error') return 'bg-surface text-fg-muted'
  return 'bg-accent/12 text-accent' // allow
}

export default function PolicyPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [policy, setPolicy] = useState<PolicyStatusView | null>(null)
  const [entries, setEntries] = useState<AuditEntryView[]>([])
  const [sandbox, setSandbox] = useState<SandboxState | null>(null)
  const [limit, setLimit] = useState(20)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (n: number): Promise<void> => {
    setBusy(true)
    try {
      const [p, a, s] = await Promise.all([window.wraith.policyStatus(), window.wraith.auditList(n), window.wraith.sandboxGet()])
      setPolicy(p); setEntries(a.entries); setSandbox(s); setError(null)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  const toggleSandbox = useCallback(async (): Promise<void> => {
    if (!sandbox) return
    try { setSandbox(await window.wraith.sandboxSet(!sandbox.networkAllowed)) }
    catch (err) { setError((err as Error).message) }
  }, [sandbox])

  useEffect(() => { void load(limit) }, [load, limit])

  const row = 'flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="policy-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.5} />安全策略 · 审计
        </span>
        <button onClick={() => void load(limit)} title="刷新" className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg">
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 panel-content">
        {/* 策略状态 */}
        <div className="mb-2 text-3xs uppercase tracking-wider text-fg-subtle">策略</div>
        <div className="mb-2 flex flex-col gap-2">
          <div className={row}><span className="text-fg-muted">项目根</span><span className="min-w-0 break-all text-right text-fg">{policy?.projectRoot || '—'}</span></div>
          <div className={row}><span className="text-fg-muted">审计目录</span><span className="min-w-0 break-all text-right text-fg">{policy?.auditDir || '—'}</span></div>
          <div className={row}>
            <span className="shrink-0 text-fg-muted">危险工具</span>
            <span className="flex flex-wrap justify-end gap-1">
              {(policy?.dangerousTools ?? []).map((t) => <span key={t} className="rounded bg-surface px-1.5 py-0.5 text-3xs text-fg-muted">{t}</span>)}
              <span className="rounded bg-surface px-1.5 py-0.5 text-3xs text-fg-muted">mcp__*</span>
            </span>
          </div>
          <div className={row}>
            <span className="min-w-0 flex-1">
              <span className="text-fg-muted">命令沙箱联网</span>
              <span className="mt-0.5 block text-3xs text-fg-subtle">
                {sandbox && !sandbox.available
                  ? '当前无沙箱(非 macOS 或不可用),命令不受网络限制'
                  : '关=禁止 agent 命令联网(默认更安全);开=本次运行放行,重启恢复禁网'}
              </span>
            </span>
            <button
              data-testid="sandbox-net-toggle"
              onClick={() => void toggleSandbox()}
              disabled={!sandbox || !sandbox.available}
              aria-label="命令沙箱联网"
              className={'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ' + (sandbox?.networkAllowed ? 'bg-accent' : 'bg-border')}
            >
              <span className={'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (sandbox?.networkAllowed ? 'translate-x-4' : 'translate-x-0')} />
            </button>
          </div>
        </div>
        <div className="mb-4 rounded-lg border border-border bg-surface/40 px-3 py-2 text-3xs leading-relaxed text-fg-subtle">
          {FIXED_POLICY.map((line) => <div key={line}>· {line}</div>)}
        </div>

        {/* 审计 */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-3xs uppercase tracking-wider text-fg-subtle">审计(危险工具调用)</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-lg border border-border bg-transparent px-2 py-0.5 text-3xs text-fg-muted">
            <option value={10}>最近 10</option>
            <option value={20}>最近 20</option>
            <option value={50}>最近 50</option>
          </select>
        </div>
        {busy && entries.length === 0 ? (
          <div className="text-xs text-fg-subtle">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-fg-subtle">今日尚无审计记录。危险工具(写文件 / 执行命令等)一经调用即记录在此。</div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e, i) => (
              <div key={e.timestamp + i} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2 text-3xs">
                  <span className={'rounded px-1.5 py-0.5 ' + outcomeClass(e.outcome)}>{outcomeLabel(e.outcome)}</span>
                  <span className="font-medium text-fg">{e.tool}</span>
                  <span className="text-fg-subtle">{formatAuditTime(e.timestamp)}</span>
                  <span className="text-fg-subtle">{e.durationMs}ms</span>
                  {e.approver && approverLabel(e.approver) && <span className="text-fg-subtle">· {approverLabel(e.approver)}</span>}
                </div>
                {e.args && <div className="mt-1 break-words font-mono text-3xs text-fg-muted">{e.args}</div>}
                {e.reason && <div className="mt-1 text-3xs text-fg-subtle">原因:{e.reason}</div>}
                {e.browserMode && <div className="mt-1 text-3xs text-fg-subtle">浏览器:mode={e.browserMode}{e.sensitive ? ' · 敏感页' : ''}{e.targetUrl ? ` · ${e.targetUrl}` : ''}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
