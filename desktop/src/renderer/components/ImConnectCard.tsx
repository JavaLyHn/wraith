import { useEffect, useRef, useState } from 'react'
import { bindPhaseLabel } from '../lib/gatewayLabels'
import { applyBindEvent, type BindState } from '../lib/imBind'
import type { PanelId } from '../lib/panelActions'
import type { GatewayEvent } from '../../shared/gateway'

interface ImConnectCardProps {
  /** 后端 im_connect 工具传来的平台 id。 */
  platform: string
  /** 微信绑定用的工作目录(可空)。 */
  workspace?: string | null
  /** feishu/wecom 退化到开面板。 */
  onOpenPanel: (id: PanelId) => void
}

const LABELS: Record<string, string> = { qq: 'QQ', weixin: '微信', feishu: '飞书', wecom: '企业微信' }

/**
 * 聊天内 IM 接入卡。⚠ 点击「开始」才启动绑定(不在挂载时启动):
 * transcript 历史回放会重建本 item,挂载即 spawn 会在每次 resume 重启绑定进程。
 */
export default function ImConnectCard({ platform, workspace, onOpenPanel }: ImConnectCardProps): JSX.Element | null {
  const p = (platform || '').trim().toLowerCase()
  const [bind, setBind] = useState<BindState | null>(null)
  const [started, setStarted] = useState(false)
  // useEffect(..., []) 的闭包只捕获挂载时的初值,普通 state 无法反映"是否已点击开始";
  // 用 ref 才能让事件回调实时读到最新的启动状态。
  const startedRef = useRef(false)

  // 挂载只订阅事件(不启动绑定);未点击「开始」的卡片必须忽略全局 bind 事件——
  // 否则第二张卡 / 面板里正在跑的绑定会被这里的 setBind 误接管,甚至误触「取消」。
  useEffect(() => {
    const unsub = window.wraith.onGatewayEvent((evt: GatewayEvent) => {
      if (evt.kind === 'bind' && startedRef.current) setBind(prev => applyBindEvent(prev, evt))
    })
    return () => unsub()
  }, [])

  // feishu / wecom:无扫码,退化到开面板填密钥。
  if (p === 'feishu' || p === 'wecom') {
    return (
      <div data-testid="im-connect-card" className="self-start flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg">
        <span>接入 {LABELS[p]} 需要在面板填写密钥(App ID / Secret)。</span>
        <button
          data-testid="im-connect-open-panel"
          onClick={() => onOpenPanel('im-gateway')}
          className="self-start rounded-lg border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
        >🧭 打开 IM 网关面板</button>
      </div>
    )
  }
  if (p !== 'qq' && p !== 'weixin') return null

  const start = (): void => {
    startedRef.current = true
    setStarted(true)
    setBind({ phase: 'scanning' })
    if (p === 'weixin') void window.wraith.gatewayBindWeixinStart(workspace?.trim() || undefined)
    else void window.wraith.gatewayBindStart()
  }

  return (
    <div data-testid="im-connect-card" className="self-start flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-fg">
      <span className="font-medium">接入 {LABELS[p]}</span>

      {!started && (
        <button
          data-testid="im-connect-start"
          onClick={start}
          className="self-start rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent/10"
        >{p === 'weixin' ? '扫码绑定微信' : '打开 QQ 授权页'}</button>
      )}

      {started && p === 'qq' && (
        <div className="text-xs text-fg-muted">已在系统浏览器打开 QQ 扫码授权页,请在浏览器完成授权;完成后此处会显示结果。</div>
      )}

      {started && p === 'weixin' && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface/40 p-3">
          <div className="text-xs text-fg-muted">请用目标微信扫描二维码</div>
          {bind?.qr ? (
            <img data-testid="im-connect-qr" src={bind.qr} alt="微信绑定二维码" className="h-44 w-44 rounded-md bg-white p-2" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-border text-2xs text-fg-subtle">二维码生成中…</div>
          )}
          {bind?.url && (
            <button className="text-2xs text-accent hover:underline" onClick={() => void window.wraith.openExternal(bind.url!)}>扫不出?在浏览器打开链接</button>
          )}
        </div>
      )}

      {started && bind && (
        <div data-testid="im-connect-status" className={'text-xs ' + (bind.phase === 'bound' ? 'text-ok' : bind.phase === 'failed' || bind.phase === 'secret-invalid' ? 'text-danger' : 'text-fg-muted')}>
          {bindPhaseLabel(bind.phase, bind.message)}
        </div>
      )}

      {started && bind?.phase === 'scanning' && (
        <button data-testid="im-connect-cancel" onClick={() => void window.wraith.gatewayBindCancel()} className="self-start text-2xs text-fg-subtle hover:text-fg">取消</button>
      )}
    </div>
  )
}
