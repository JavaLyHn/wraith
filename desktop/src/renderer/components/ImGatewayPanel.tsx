import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { GatewayBindPhase, GatewayConfigView, GatewayState, GatewayStatus } from '../../shared/gateway'
import { maskId, bindPhaseLabel } from '../lib/gatewayLabels'
import { IM_PLATFORMS } from '../lib/imPlatforms'
import { PlatformIcon } from '../lib/imPlatformIcons'
import { feishuConfigPayload } from '../lib/feishuConfigPayload'
import { wecomConfigPayload } from '../lib/wecomConfigPayload'

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
  running: 'text-ok',
  error: 'text-danger',
}

const INPUT = 'mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent'
const BTN_PRIMARY = 'rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60'
const BTN_SECONDARY = 'rounded-lg border border-border px-4 py-2 text-xs text-fg-muted hover:bg-surface/60'

export default function ImGatewayPanel({ onBack }: ImGatewayPanelProps): JSX.Element {
  const [config, setConfig] = useState<GatewayConfigView | null>(null)
  const [status, setStatus] = useState<GatewayStatus>({ state: 'stopped' })
  const [bind, setBind] = useState<{ phase: GatewayBindPhase; message?: string; qr?: string; url?: string } | null>(null)
  const [secretInput, setSecretInput] = useState('')
  const [secretBusy, setSecretBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('qq')
  // 网关是全局单进程:任一平台已配置即可启动;anyBound 汇总所有平台的绑定态。
  const [anyBound, setAnyBound] = useState(false)
  // 飞书表单输入(受控)
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsOwner, setFsOwner] = useState('')
  const [fsRegion, setFsRegion] = useState('feishu')
  const [fsWorkspace, setFsWorkspace] = useState('')
  const [fsBusy, setFsBusy] = useState(false)
  const [fsHint, setFsHint] = useState<string | null>(null)
  // 企微表单输入(受控)
  const [wcBotId, setWcBotId] = useState('')
  const [wcSecret, setWcSecret] = useState('')
  const [wcOwner, setWcOwner] = useState('')
  const [wcWorkspace, setWcWorkspace] = useState('')
  const [wcBusy, setWcBusy] = useState(false)
  const [wcHint, setWcHint] = useState<string | null>(null)
  // 微信表单输入(受控)
  const [wxWorkspace, setWxWorkspace] = useState('')
  const [wxBusy, setWxBusy] = useState(false)
  const [wxHint, setWxHint] = useState<string | null>(null)

  const refreshConfig = useCallback(async () => {
    setConfig(null)
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
      if (selectedPlatform === 'wecom') {
        setWcBotId(cfg.botId ?? '')
        setWcOwner(cfg.ownerUserid ?? '')
        setWcWorkspace(cfg.workspace ?? '')
        // secret 永不回填(后端只回 hasSecret);留空 = 保持已存密钥
      }
      if (selectedPlatform === 'weixin') {
        setWxWorkspace(cfg.workspace ?? '')
      }
    } catch (err) {
      console.error('[wraith] gatewayGetConfig error:', err)
      if (selectedPlatform === 'feishu') setFsHint('读取配置失败')
      else if (selectedPlatform === 'wecom') setWcHint('读取配置失败')
      else if (selectedPlatform === 'weixin') setWxHint('读取配置失败')
      else setHint('读取配置失败')
    }
    // 网关是全局进程:汇总所有平台绑定态,决定「启动网关」是否可点(与当前选中平台无关)。
    try {
      const [qq, fs, wc, wx] = await Promise.all([
        window.wraith.gatewayGetConfig('qq'),
        window.wraith.gatewayGetConfig('feishu'),
        window.wraith.gatewayGetConfig('wecom'),
        window.wraith.gatewayGetConfig('weixin'),
      ])
      setAnyBound(!!qq?.bound || !!fs?.bound || !!wc?.bound || !!wx?.bound)
    } catch {
      /* 忽略:失败则按钮保持禁用 */
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
        // 微信扫码:scanning 阶段会分几条来(「请扫码」行、带 qr 的图片行、带 url 的兜底链接行)。
        // 逐条到达时保留已拿到的 qr / url,避免后一条把前一条冲掉;非 scanning 阶段清空。
        setBind(prev => ({
          phase: evt.phase,
          message: evt.message,
          qr: evt.qr ?? (evt.phase === 'scanning' ? prev?.qr : undefined),
          url: evt.url ?? (evt.phase === 'scanning' ? prev?.url : undefined),
        }))
        if (evt.phase === 'bound' || evt.phase === 'secret-invalid') void refreshConfig()
      }
    })
    return () => { unsub() }
  }, [refreshConfig, refreshStatus])

  // 微信扫码绑定期间,若用户展开了日志则每 2s 刷新;二维码本身走图片事件(见下方 QR 卡片),不再依赖日志区。
  useEffect(() => {
    if (selectedPlatform !== 'weixin' || bind?.phase !== 'scanning' || !showLogs) return
    const t = setInterval(async () => {
      try { const { lines } = await window.wraith.gatewayLogs(); setLogs(lines) }
      catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(t)
  }, [selectedPlatform, bind?.phase, showLogs])

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

  const handleBindWeixin = () => {
    setBind({ phase: 'scanning' })
    void window.wraith.gatewayBindWeixinStart(wxWorkspace.trim() || undefined)
  }

  const handleSaveWeixinWorkspace = async () => {
    setWxBusy(true)
    setWxHint(null)
    try {
      await window.wraith.gatewaySetWeixinConfig({ workspace: wxWorkspace.trim() })
      setWxHint('已保存')
      await refreshConfig()
    } catch {
      setWxHint('保存失败')
    } finally {
      setWxBusy(false)
    }
  }

  const handleSaveWecom = async () => {
    setWcBusy(true)
    setWcHint(null)
    try {
      const payload = wecomConfigPayload({
        botId: wcBotId, secret: wcSecret, ownerUserid: wcOwner, workspace: wcWorkspace,
      })
      await window.wraith.gatewaySetWecomConfig(payload)
      setWcSecret('')                 // 保存后清空密钥输入(不回显)
      setWcHint('已保存')
      await refreshConfig()
    } catch (err) {
      setWcHint('保存失败')
    } finally {
      setWcBusy(false)
    }
  }

  const bound = config?.bound ?? false
  const running = status.state === 'running' || status.state === 'starting'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="im-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="text-sm font-bold text-fg">IM 网关</span>
        <span className="text-xs text-fg-subtle">对话式 IM 接入</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 panel-content">
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
                  <span className={'flex h-5 items-center justify-center ' + (isSelected ? 'text-accent' : 'text-fg-muted')}>
                    {PlatformIcon({ id: p.id, className: 'h-5 w-5' }) ?? <span className="text-xl leading-none">{p.icon}</span>}
                  </span>
                  <span className="max-w-full truncate text-2xs text-fg">{p.name}</span>
                  <span className={'text-3xs ' + (isSelected && bound ? 'text-ok' : 'text-fg-subtle')}>{statusText}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 当前平台配置分隔 */}
        <div className="flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          {selectedPlatform === 'feishu' ? '飞书 / Lark · 机器人'
            : selectedPlatform === 'wecom' ? '企业微信 · 机器人'
            : selectedPlatform === 'weixin' ? '微信 · 单聊(扫码)'
            : 'QQ · 单聊'}
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
                  className={'mt-2 text-xs ' + (bind.phase === 'bound' ? 'text-ok' : bind.phase === 'failed' || bind.phase === 'secret-invalid' ? 'text-danger' : 'text-fg-muted')}>
                  {bindPhaseLabel(bind.phase, bind.message)}
                </div>
              )}
            </section>

            {/* 机器人密钥手填(openclaw 给的失效时的兜底) */}
            <section className="rounded-lg border border-border p-4">
              <div className="mb-1 text-xs font-bold text-fg">机器人密钥（手填兜底）</div>
              <div className="text-2xs text-fg-subtle">openclaw 偶发返回失效密钥;可到 q.qq.com 后台复制「机器人密钥」直接填入。</div>
              <label className="mt-2 block text-xs text-fg-muted">
                AppSecret {config?.hasSecret && <span className="text-3xs text-ok">(已存,留空则保持)</span>}
                <input data-testid="im-secret" type="password" value={secretInput}
                  onChange={e => setSecretInput(e.target.value)}
                  placeholder={config?.hasSecret ? '••••••(留空保持已存)' : '粘贴机器人密钥'}
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
              App Secret {config?.hasSecret && <span className="text-3xs text-ok">(已存,留空则保持)</span>}
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

        {selectedPlatform === 'wecom' && (
          <section className="rounded-lg border border-border p-4" data-testid="im-wecom-form">
            <div className="mb-1 text-xs font-bold text-fg">企业微信智能机器人</div>
            <div className="text-2xs text-fg-subtle">
              在 企业微信管理后台 建智能机器人,API 接收模式选「长连接」,把 BotID / Secret 填这里(与回调模式的 Token/AESKey 不同)。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              BotID
              <input data-testid="im-wc-botid" value={wcBotId} onChange={e => setWcBotId(e.target.value)}
                placeholder="机器人 BotID" className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              Secret {config?.hasSecret && <span className="text-3xs text-ok">(已存,留空则保持)</span>}
              <input data-testid="im-wc-secret" type="password" value={wcSecret} onChange={e => setWcSecret(e.target.value)}
                placeholder={config?.hasSecret ? '••••••(留空保持已存)' : '粘贴长连接 Secret'} className={INPUT} />
            </label>
            <label className="mt-2 block text-xs text-fg-muted">
              主人 userid
              <input data-testid="im-wc-owner" value={wcOwner} onChange={e => setWcOwner(e.target.value)}
                placeholder="留空:先私聊 bot 拿回显" className={INPUT} />
            </label>
            <div className="mt-1 text-3xs text-fg-subtle">
              未填主人时,启动网关后私聊 bot,它会回显你的 userid;填进来再重启即绑定。主动推送(审批卡/定时投递)需要你先给 bot 发过消息。
            </div>
            <label className="mt-2 block text-xs text-fg-muted">
              工作目录
              <input data-testid="im-wc-workspace" value={wcWorkspace} onChange={e => setWcWorkspace(e.target.value)}
                placeholder="/path/to/workspace" className={INPUT} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button data-testid="im-wc-save" disabled={wcBusy} onClick={() => void handleSaveWecom()} className={BTN_PRIMARY}>
                {wcBusy ? '保存中…' : '保存企微配置'}
              </button>
              {wcHint && <span className="text-xs text-fg-subtle">{wcHint}</span>}
            </div>
          </section>
        )}

        {selectedPlatform === 'weixin' && (
          <section className="rounded-lg border border-border p-4" data-testid="im-weixin-form">
            <div className="mb-1 text-xs font-bold text-fg">个人微信(官方 ClawBot / iLink)</div>
            <div className="text-2xs text-fg-subtle">
              手机微信扫码即绑定,扫码者即主人;⚠ 与终端 /wechat 通道不可同时运行。
            </div>
            {bound ? (
              <div className="mt-2 space-y-1 text-xs text-fg-muted">
                <div>主人:<span className="text-fg">{maskId(config?.ownerUserid ?? null)}</span></div>
                <div>工作目录:<span className="truncate text-fg">{config?.workspace ?? '—'}</span></div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-fg-subtle">
                未绑定——点「扫码绑定」,二维码会显示在下方;扫不出可点卡片里的链接在浏览器打开。
              </div>
            )}
            <label className="mt-2 block text-xs text-fg-muted">
              工作目录{!bound && <span className="text-3xs text-fg-subtle">(未绑定时随扫码绑定一并设置)</span>}
              <input data-testid="im-wx-workspace" value={wxWorkspace} onChange={e => setWxWorkspace(e.target.value)}
                placeholder="/path/to/workspace" className={INPUT} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button data-testid="im-wx-bind" onClick={handleBindWeixin}
                className={bound ? BTN_SECONDARY : BTN_PRIMARY}>{bound ? '重新扫码绑定' : '扫码绑定'}</button>
              {bind?.phase === 'scanning' && (
                <button onClick={() => void window.wraith.gatewayBindCancel()} className={BTN_SECONDARY}>取消</button>
              )}
              <button data-testid="im-wx-save" disabled={wxBusy || !bound}
                onClick={() => void handleSaveWeixinWorkspace()} className={BTN_SECONDARY}>
                {wxBusy ? '保存中…' : '保存工作目录'}
              </button>
              {wxHint && <span className="text-xs text-fg-subtle">{wxHint}</span>}
            </div>
            {bind && selectedPlatform === 'weixin' && (
              <div data-testid="im-wx-bind-status"
                className={'mt-2 text-xs ' + (bind.phase === 'bound' ? 'text-ok' : bind.phase === 'failed' ? 'text-danger' : 'text-fg-muted')}>
                {bindPhaseLabel(bind.phase, bind.message)}
              </div>
            )}

            {/* 扫码期二维码卡片:后端在非交互式环境把二维码渲染成 PNG(WRAITH_QR_PNG 标记),
                这里直接当图片显示,取代过去日志区里糊成乱码的 ANSI 半块。 */}
            {selectedPlatform === 'weixin' && bind?.phase === 'scanning' && (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-border bg-surface/40 p-4">
                <div className="text-xs text-fg-muted">请用目标微信扫描二维码</div>
                {bind.qr ? (
                  <img src={bind.qr} alt="微信绑定二维码" data-testid="im-wx-qr"
                    className="h-52 w-52 rounded-md bg-white p-2" />
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center rounded-md border border-dashed border-border text-2xs text-fg-subtle">
                    二维码生成中…
                  </div>
                )}
                <div className="text-3xs text-fg-subtle">扫码后在手机微信确认;二维码约 5 分钟过期</div>
                {bind.url && (
                  <button data-testid="im-wx-qr-link"
                    onClick={() => void window.wraith.openExternal(bind.url!)}
                    className="text-3xs text-accent hover:underline">
                    扫不出?点此在浏览器打开链接
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* 守护进程开关 + 状态 */}
        <section className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-bold text-fg">网关守护进程（所有已配置平台共用）</span>
            <span data-testid="im-status" className={'text-xs ' + STATUS_COLOR[status.state]}>
              ● {STATUS_LABEL[status.state]}
            </span>
          </div>
          {status.message && <div className="mb-2 text-xs text-danger">{status.message}</div>}
          <div className="flex items-center gap-2">
            <button data-testid="im-toggle" onClick={handleToggleDaemon}
              disabled={!anyBound} className={running ? BTN_SECONDARY : BTN_PRIMARY}>
              {running ? '停止网关' : '启动网关'}
            </button>
            <button onClick={() => void handleShowLogs()} className={BTN_SECONDARY}>
              {showLogs ? '隐藏日志' : '查看日志'}
            </button>
          </div>
          {!anyBound && <div className="mt-2 text-2xs text-fg-subtle">先配置并保存至少一个平台，再启动网关（一个进程服务所有已配置平台）。</div>}
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
