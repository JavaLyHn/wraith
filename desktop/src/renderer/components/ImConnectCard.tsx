import { useEffect, useRef, useState } from 'react'
import { bindDoneHint, bindPhaseLabel, IM_SHORT_LABEL as LABELS } from '../lib/gatewayLabels'
import { applyBindEvent, type BindState } from '../lib/imBind'
import { consoleLink } from '../lib/imConsoleLinks'
import type { PanelId } from '../lib/panelActions'
import type { GatewayEvent, GatewayState } from '../../shared/gateway'

interface ImConnectCardProps {
  /** 后端 im_connect 工具传来的平台 id。 */
  platform: string
  /** 微信绑定用的工作目录(可空)。 */
  workspace?: string | null
  /** feishu/wecom 退化到开面板。 */
  onOpenPanel: (id: PanelId) => void
  /**
   * 绑定成功时上报一次(带已查明的网关运行态),供上层补一轮系统事件让 agent 知情。
   * 只在本卡亲自发起的绑定成功时触发 —— 历史回放重建的卡 started=false,不会误报。
   */
  onBound?: (platform: string, gatewayState: GatewayState | null) => void
}

/**
 * 聊天内 IM 接入卡。⚠ 点击「开始」才启动绑定(不在挂载时启动):
 * transcript 历史回放会重建本 item,挂载即 spawn 会在每次 resume 重启绑定进程。
 */
export default function ImConnectCard({ platform, workspace, onOpenPanel, onBound }: ImConnectCardProps): JSX.Element | null {
  const p = (platform || '').trim().toLowerCase()
  const [bind, setBind] = useState<BindState | null>(null)
  const [started, setStarted] = useState(false)
  // 网关运行态:绑定成功后用来决定敢不敢说「可以发消息了」。null = 还没查到。
  const [gwState, setGwState] = useState<GatewayState | null>(null)
  // useEffect(..., []) 的闭包只捕获挂载时的初值,普通 state 无法反映"是否已点击开始";
  // 用 ref 才能让事件回调实时读到最新的启动状态。
  const startedRef = useRef(false)

  // 挂载只订阅事件(不启动绑定);未点击「开始」的卡片必须忽略全局 bind 事件——
  // 否则第二张卡 / 面板里正在跑的绑定会被这里的 setBind 误接管,甚至误触「取消」。
  useEffect(() => {
    const unsub = window.wraith.onGatewayEvent((evt: GatewayEvent) => {
      if (evt.kind === 'bind' && startedRef.current) setBind(prev => applyBindEvent(prev, evt))
      // 运行态是全局的(不属于某次绑定),故不受 startedRef 门控 —— 只读,不会像 bind 那样
      // 让本卡误接管别处正在跑的绑定。
      else if (evt.kind === 'status') setGwState(evt.status.state)
    })
    return () => unsub()
  }, [])

  // 绑定成功的瞬间补拉一次运行态:此前可能一条 status 事件都没来过,
  // 不查就只能含糊其辞,没法如实告诉用户「到底能不能用了」。
  // onBound 通常是父层每次渲染新建的闭包,放 ref 里免得它进 effect 依赖反复触发上报。
  const onBoundRef = useRef(onBound)
  useEffect(() => { onBoundRef.current = onBound }, [onBound])
  const reportedRef = useRef(false)

  useEffect(() => {
    if (bind?.phase !== 'bound') return
    let alive = true
    // 先把运行态查出来再上报:agent 拿这条去向用户宣布结果,状态未知就只能含糊其辞。
    const report = (s: GatewayState | null): void => {
      if (!alive) return
      if (s !== null) setGwState(s)
      if (reportedRef.current) return
      reportedRef.current = true
      onBoundRef.current?.(p, s)
    }
    void window.wraith.gatewayStatus().then(st => report(st.state), () => report(null))
    return () => { alive = false }
  }, [bind?.phase, p])

  // feishu / wecom:**没有扫码这回事** —— 它们要的是开发者后台建应用后拿到的凭证
  // (两个 provider 包里扫码相关关键词零命中)。所以这里不是「二维码没做」,是不存在。
  // 但也不能只甩一句「去面板填密钥」就完 —— 用户下一个问题必然是「去哪拿」。
  // 给出直达后台的链接 + 说清要拿什么回来。
  if (p === 'feishu' || p === 'wecom') {
    const link = consoleLink(p)
    return (
      <div data-testid="im-connect-card" className="self-start flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg">
        <span>接入 {LABELS[p]} 不用扫码,填一组开发者后台的凭证即可。</span>
        <span data-testid="im-connect-what" className="text-2xs text-fg-subtle">{link.what}</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            data-testid="im-connect-console"
            onClick={() => void window.wraith.openExternal(link.url)}
            className="rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent/10"
          >{link.label}</button>
          <button
            data-testid="im-connect-open-panel"
            onClick={() => onOpenPanel('im-gateway')}
            className="rounded-lg border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
          >🧭 打开 IM 网关面板</button>
        </div>
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

  // 引导区(二维码 / 浏览器授权提示)只属于 scanning。终态(bound/failed/cancelled/
  // secret-invalid)必须整块撤掉 —— 否则会像老 bug 那样,「请扫码」「二维码生成中…」
  // 和「✅ 绑定成功」同屏并存,自相矛盾。
  const scanning = bind?.phase === 'scanning'
  const bound = bind?.phase === 'bound'

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

      {/* QQ:内联二维码与浏览器授权页**并存**。那条 connect URL 原本是给桌面浏览器的
          (QQ 页面再渲染真正的扫码图),把它本身编码成二维码能不能直接扫通尚未证实 ——
          所以浏览器那条路原样保留,扫得通只是省一跳。 */}
      {scanning && p === 'qq' && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface/40 p-3">
          <div className="text-xs text-fg-muted">用手机 QQ 扫码授权</div>
          {bind?.qr ? (
            <img data-testid="im-connect-qr" src={bind.qr} alt="QQ 授权二维码" className="h-44 w-44 rounded-md bg-white p-2" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-border text-2xs text-fg-subtle">二维码生成中…</div>
          )}
          <div className="text-2xs text-fg-subtle">扫不出也没关系 —— 授权页已在浏览器打开,在那边完成同样有效</div>
          {bind?.url && (
            <button
              data-testid="im-connect-open-url"
              className="text-2xs text-accent hover:underline"
              onClick={() => void window.wraith.openExternal(bind.url!)}
            >重新打开授权页</button>
          )}
        </div>
      )}

      {scanning && p === 'weixin' && (
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

      {/* bound 有专属收尾块(下方),这里只报非成功态,避免两处重复说同一件事。 */}
      {started && bind && !bound && (
        <div data-testid="im-connect-status" className={'text-xs ' + (bind.phase === 'failed' || bind.phase === 'secret-invalid' ? 'text-danger' : 'text-fg-muted')}>
          {bindPhaseLabel(bind.phase, bind.message)}
        </div>
      )}

      {bound && (
        <div data-testid="im-connect-done" className="flex flex-col gap-1.5 rounded-lg border border-ok/40 bg-ok/5 p-2.5">
          <span className="text-xs text-ok">✅ {LABELS[p]} 已配置好,主人身份已绑定。</span>
          <span className="text-2xs text-fg-muted">{bindDoneHint(LABELS[p]!, gwState)}</span>
          <div className="flex flex-wrap gap-1.5">
            {gwState === 'stopped' && (
              <button
                data-testid="im-connect-start-gateway"
                onClick={() => void window.wraith.gatewayStart()}
                className="rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent/10"
              >▶ 启动网关</button>
            )}
            <button
              data-testid="im-connect-open-panel"
              onClick={() => onOpenPanel('im-gateway')}
              className="rounded-lg border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
            >🧭 打开 IM 网关面板</button>
          </div>
        </div>
      )}

      {started && bind?.phase === 'scanning' && (
        <button data-testid="im-connect-cancel" onClick={() => void window.wraith.gatewayBindCancel()} className="self-start text-2xs text-fg-subtle hover:text-fg">取消</button>
      )}
    </div>
  )
}
