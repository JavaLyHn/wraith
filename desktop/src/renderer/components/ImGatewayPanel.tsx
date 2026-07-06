import { useCallback, useEffect, useState } from 'react'
import type { GatewayBindPhase, GatewayConfigView, GatewayState, GatewayStatus } from '../../shared/gateway'
import { maskId, bindPhaseLabel } from '../lib/gatewayLabels'
import { IM_PLATFORMS } from '../lib/imPlatforms'

interface ImGatewayPanelProps {
  onBack: () => void
}

const STATUS_LABEL: Record<GatewayState, string> = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  error: '错误',
}
const STATUS_COLOR: Record<GatewayState, string> = {
  stopped: 'text-fg-subtle',
  starting: 'text-amber-500',
  running: 'text-success',
  error: 'text-danger',
}

const INPUT = 'mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent'
const BTN_PRIMARY = 'rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60'
const BTN_SECONDARY = 'rounded-lg border border-border px-4 py-2 text-xs text-fg-muted hover:bg-surface/60'

export default function ImGatewayPanel({ onBack }: ImGatewayPanelProps): JSX.Element {
  const [config, setConfig] = useState<GatewayConfigView | null>(null)
  const [status, setStatus] = useState<GatewayStatus>({ state: 'stopped' })
  const [bind, setBind] = useState<{ phase: GatewayBindPhase; message?: string } | null>(null)
  const [secretInput, setSecretInput] = useState('')
  const [secretBusy, setSecretBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)

  const refreshConfig = useCallback(async () => {
    try { setConfig(await window.wraith.gatewayGetConfig()) }
    catch (err) { console.error('[wraith] gatewayGetConfig error:', err) }
  }, [])

  const refreshStatus = useCallback(async () => {
    try { setStatus(await window.wraith.gatewayStatus()) }
    catch (err) { console.error('[wraith] gatewayStatus error:', err) }
  }, [])

  useEffect(() => {
    void refreshConfig()
    void refreshStatus()
    const unsub = window.wraith.onGatewayEvent(evt => {
      if (evt.kind === 'status') setStatus(evt.status)
      else if (evt.kind === 'bind') {
        setBind({ phase: evt.phase, message: evt.message })
        if (evt.phase === 'bound' || evt.phase === 'secret-invalid') void refreshConfig()
      }
    })
    return () => { unsub() }
  }, [refreshConfig, refreshStatus])

  const handleBind = useCallback(() => {
    setBind({ phase: 'scanning' })
    void window.wraith.gatewayBindStart()
  }, [])

  const handleSaveSecret = useCallback(async () => {
    const s = secretInput.trim()
    if (!s) return
    setSecretBusy(true)
    try {
      await window.wraith.gatewaySetSecret(s)
      setSecretInput('')
      setHint('机器人密钥已保存')
      setBind(null)
      await refreshConfig()
    } catch (err) {
      setHint('保存失败: ' + (err as Error).message)
    } finally {
      setSecretBusy(false)
    }
  }, [secretInput, refreshConfig])

  const handlePickWorkspace = useCallback(async () => {
    const dir = await window.wraith.gatewayPickWorkspace()
    if (dir) { await window.wraith.gatewaySetWorkspace(dir); await refreshConfig(); setHint('工作目录已更新') }
  }, [refreshConfig])

  const handleToggleDaemon = useCallback(() => {
    if (status.state === 'running' || status.state === 'starting') void window.wraith.gatewayStop()
    else void window.wraith.gatewayStart()
  }, [status.state])

  const handleShowLogs = useCallback(async () => {
    const next = !showLogs
    setShowLogs(next)
    if (next) {
      try { const { lines } = await window.wraith.gatewayLogs(); setLogs(lines) }
      catch (err) { console.error('[wraith] gatewayLogs error:', err) }
    }
  }, [showLogs])

  const bound = config?.bound ?? false
  const running = status.state === 'running' || status.state === 'starting'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="im-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">IM 网关</span>
        <span className="text-xs text-fg-subtle">对话式 IM 接入</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* 接入平台:QQ 可用,其余参照 hermes 平台清单标「即将支持」占位 */}
        <section>
          <div className="mb-2 text-xs font-bold text-fg">接入平台</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {IM_PLATFORMS.map(p => {
              const isAvailable = p.status === 'available'
              const statusText = isAvailable ? (bound ? '✓ 已配置' : '未配置') : '即将支持'
              return (
                <div
                  key={p.id}
                  data-testid={`im-platform-${p.id}`}
                  title={isAvailable ? `${p.name}${p.note ? ' · ' + p.note : ''}` : `${p.name} — 即将支持`}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border p-3 text-center ' +
                    (isAvailable ? 'border-accent bg-surface/60' : 'cursor-not-allowed border-border opacity-50')
                  }
                >
                  <span className="text-xl leading-none">{p.icon}</span>
                  <span className="max-w-full truncate text-[11px] text-fg">{p.name}</span>
                  <span className={'text-[10px] ' + (isAvailable && bound ? 'text-success' : 'text-fg-subtle')}>{statusText}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 当前平台配置分隔 */}
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          QQ · 单聊
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* 绑定状态卡 */}
        <section className="rounded-lg border border-border p-4">
          <div className="mb-2 text-xs font-bold text-fg">绑定状态</div>
          {bound ? (
            <div className="space-y-1 text-xs text-fg-muted">
              <div>AppID：<span className="text-fg" data-testid="im-appid">{maskId(config?.appId ?? null)}</span></div>
              <div>Owner：{maskId(config?.ownerOpenid ?? null)}</div>
              <div className="flex items-center gap-2">
                工作目录：<span className="truncate text-fg">{config?.workspace ?? '—'}</span>
                <button onClick={() => void handlePickWorkspace()} className="shrink-0 text-accent hover:underline">更改</button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-fg-subtle">未绑定——扫码绑定你的 QQ 机器人。</div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button data-testid="im-bind" onClick={handleBind}
              className={bound ? BTN_SECONDARY : BTN_PRIMARY}>{bound ? '重新绑定' : '扫码绑定'}</button>
            {bind?.phase === 'scanning' && (
              <button onClick={() => void window.wraith.gatewayBindCancel()} className={BTN_SECONDARY}>取消</button>
            )}
          </div>
          {bind && (
            <div data-testid="im-bind-status"
              className={'mt-2 text-xs ' + (bind.phase === 'bound' ? 'text-success' : bind.phase === 'failed' || bind.phase === 'secret-invalid' ? 'text-danger' : 'text-fg-muted')}>
              {bindPhaseLabel(bind.phase, bind.message)}
            </div>
          )}
        </section>

        {/* 机器人密钥手填(openclaw 给的失效时的兜底) */}
        <section className="rounded-lg border border-border p-4">
          <div className="mb-1 text-xs font-bold text-fg">机器人密钥（手填兜底）</div>
          <div className="text-[11px] text-fg-subtle">openclaw 偶发返回失效密钥;可到 q.qq.com 后台复制「机器人密钥」直接填入。</div>
          <label className="mt-2 block text-xs text-fg-muted">
            AppSecret
            <input data-testid="im-secret" type="password" value={secretInput}
              onChange={e => setSecretInput(e.target.value)} placeholder="粘贴机器人密钥"
              className={INPUT} />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button data-testid="im-secret-save" onClick={() => void handleSaveSecret()}
              disabled={secretBusy || secretInput.trim().length === 0} className={BTN_PRIMARY}>保存密钥</button>
            {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
          </div>
        </section>

        {/* 守护进程开关 + 状态 */}
        <section className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-bold text-fg">网关守护进程</span>
            <span data-testid="im-status" className={'text-xs ' + STATUS_COLOR[status.state]}>
              ● {STATUS_LABEL[status.state]}
            </span>
          </div>
          {status.message && <div className="mb-2 text-xs text-danger">{status.message}</div>}
          <div className="flex items-center gap-2">
            <button data-testid="im-toggle" onClick={handleToggleDaemon}
              disabled={!bound} className={running ? BTN_SECONDARY : BTN_PRIMARY}>
              {running ? '停止网关' : '启动网关'}
            </button>
            <button onClick={() => void handleShowLogs()} className={BTN_SECONDARY}>
              {showLogs ? '隐藏日志' : '查看日志'}
            </button>
          </div>
          {!bound && <div className="mt-2 text-[11px] text-fg-subtle">先完成绑定再启动网关。</div>}
          {showLogs && (
            <pre data-testid="im-logs"
              className="mt-3 max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2 text-[10px] text-fg-muted">
              {logs.length ? logs.join('\n') : '(暂无日志)'}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}
