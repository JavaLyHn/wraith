/**
 * imBind —— IM 扫码绑定的共享纯逻辑(面板 + 聊天内联卡同源)。
 * 无 React/Electron 依赖;只做 bind 事件→state 归并。
 */
import type { GatewayBindPhase, GatewayEvent } from '../../shared/gateway'

export interface BindState {
  phase: GatewayBindPhase
  message?: string
  qr?: string
  url?: string
}

type GatewayBindEvent = Extract<GatewayEvent, { kind: 'bind' }>

/**
 * 逐条 bind 事件归并:微信扫码 scanning 阶段会分几条来(「请扫码」行、带 qr 的图片行、带 url 的兜底链接行),
 * 保留已拿到的 qr / url(后一条不冲掉前一条);非 scanning 阶段(bound/failed/…)清空 qr/url。
 */
export function applyBindEvent(prev: BindState | null, evt: GatewayBindEvent): BindState {
  return {
    phase: evt.phase,
    message: evt.message,
    qr: evt.qr ?? (evt.phase === 'scanning' ? prev?.qr : undefined),
    url: evt.url ?? (evt.phase === 'scanning' ? prev?.url : undefined),
  }
}
