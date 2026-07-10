import { useCallback, useEffect, useState } from 'react'
import type { GatewayBindPhase, GatewayConfigView, GatewayState, GatewayStatus } from '../../shared/gateway'
import { maskId, bindPhaseLabel } from '../lib/gatewayLabels'
import { IM_PLATFORMS } from '../lib/imPlatforms'
import { feishuConfigPayload } from '../lib/feishuConfigPayload'

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
  const [selectedPlatform, setSelectedPlatform] = useState<string>('qq')
  // 飞书表单输入(受控)
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsOwner, setFsOwner] = useState('')
  const [fsRegion, setFsRegion] = useState('feishu')
  const [fsWorkspace, setFsWorkspace] = useState('')
  const [fsBusy, setFsBusy] = useState(false)
  const [fsHint, setFsHint] = useState<string | null>(null)

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await window.wraith.gatewayGetConfig(selectedPlatform)
      setConfig(cfg)
      if (selectedPlatform === 'feishu') {
        setFsAppId(cfg.appId ?? '')
        setFsOwner(cfg.ownerOpenid ?? '')
        setFsRegion(cfg.region ?? 'feishu')
        setFsWorkspace(cfg.workspace ?? '')
        // appSecret 永不回填(后端只回 hasSecret);留空 = 保持已存密钥
      }
    } catch (err) {
      setHint('读取配置失败')
    }
  }, [selectedPlatform])

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

  const handleSaveFeishu = async () => {
    setFsBusy(true)
    setFsHint(null)
    try {
      const payload = feishuConfigPayload({
        appId: fsAppId, appSecret: fsAppSecret, ownerOpenid: fsOwner, region: fsRegion, workspace: fsWorkspace,
      })
      await window.wraith.gatewaySetFeishuConfig(payload)
      setFsAppSecret('')              // 保存后清空密钥输入(不回显)
      setFsHint('已保存')
      await refreshConfig()
    } catch (err) {
      setFsHint('保存失败')
    } finally {
      setFsBusy(false)
    }
  }

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
              const isSelected = isAvailable && selectedPlatform === p.id
              const statusText = isAvailable ? (isSelected && bound ? '✓ 已配置' : '可配置') : '即将支持'
              return (
                <div
                  key={p.id}
                  data-testid={`im-platform-${p.id}`}
                  onClick={isAvailable ? () => setSelectedPlatform(p.id) : undefined}
                  title={isAvailable ? `${p.name}${p.note ? ' · ' + p.note : ''}` : `${p.name} — 即将支持`}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border p-3 text-center ' +
                    (isAvailable
                      ? (isSelected ? 'cursor-pointer border-accent bg-surface' : 'cursor-pointer border-accent bg-surface/60')
                      : 'cursor-not-allowed border-border opacity-50')
                  }
                >
                  <span className="text-xl leading-none">{p.icon}</span>
                  <span className="max-w-full truncate text-2xs text-fg">{p.name}</span>
                  <span className={'text-3xs ' + (isSelected && bound ? 'text-success' : 'text-fg-subtle')}>{statusText}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 当前平台配置分隔 */}
        <div className="flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          {selectedPlatform === 'feishu' ? '飞书 / Lark · 机器人' : 'QQ · 单聊'}
          <span className="h-px flex-1 bg-border" />
        </div>

        {selectedPlatform === 'qq' && (
          <>
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
              <div className="text-2xs text-fg-subtle">openclaw 偶发返回失效密钥;可到 q.qq.com 后台复制「机器人密钥」直接填入。</div>
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
          </>
        )}

        {selectedPlatform === 'feishu' && (
          <section className="rounded-lg border border-border p-4" data-testid="im-feishu-form">
            <div className="mb-1 text-xs font-bold text-fg">飞书自建应用</div>
            <div className="text-2xs text-fg-subtle">
              在 飞书开放平台 建自建应用(开长连接 + im:message 权限 + 订阅 im.message.receive_v1),把 App ID / App Secret 填这里。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              App ID
              <input data-testid="im-fs-appid" value={fsAppId} onChange={e => setFsAppId(e.target.value)}
                placeholder="cli_xxx" className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              App Secret {config?.hasSecret && <span className="text-3xs text-success">(已存,留空则保持)</span>}
              <input data-testid="im-fs-secret" type="password" value={fsAppSecret} onChange={e => setFsAppSecret(e.target.value)}
                placeholder={config?.hasSecret ? '••••••(留空保持已存)' : '粘贴 App Secret'} className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              区域
              <select data-testid="im-fs-region" value={fsRegion} onChange={e => setFsRegion(e.target.value)} className={INPUT}>
                <option value="feishu">飞书(open.feishu.cn)</option>
                <option value="lark">Lark 国际(open.larksuite.com)</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              主人 open_id
              <input data-testid="im-fs-owner" value={fsOwner} onChange={e => setFsOwner(e.target.value)}
                placeholder="ou_xxx(留空:先私聊 bot 拿回显)" className={INPUT} />
            </label>
            <div className="mt-1 text-3xs text-fg-subtle">
              未填主人时,启动网关后私聊 bot,它会回显你的 open_id;填进来再重启即绑定。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              工作目录
              <input data-testid="im-fs-workspace" value={fsWorkspace} onChange={e => setFsWorkspace(e.target.value)}
                placeholder="/path/to/workspace" className={INPUT} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button data-testid="im-fs-save" disabled={fsBusy} onClick={() => void handleSaveFeishu()} className={BTN_PRIMARY}>
                {fsBusy ? '保存中…' : '保存飞书配置'}
              </button>
              {fsHint && <span className="text-xs text-fg-subtle">{fsHint}</span>}
            </div>
          </section>
        )}

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
          {!bound && <div className="mt-2 text-2xs text-fg-subtle">先完成绑定再启动网关。</div>}
          {showLogs && (
            <pre data-testid="im-logs"
              className="mt-3 max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2 text-3xs text-fg-muted">
              {logs.length ? logs.join('\n') : '(暂无日志)'}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}
