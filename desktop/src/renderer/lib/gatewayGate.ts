import type { GatewayState, GatewayStatus } from '../../shared/gateway'

/** 任务副标签:网关没跑时不称"运行中"(避免误导:调度器在网关里,网关没跑任务不执行)。 */
export function taskStatusLabel(enabled: boolean, gatewayState: GatewayState): string {
  if (!enabled) return '⏸ 已暂停'
  return gatewayState === 'running' ? '● 运行中' : '已启用 · 网关未运行'
}

export interface GatewayPillView {
  text: string
  tone: 'ok' | 'warn' | 'err' | 'muted'
  action: 'start' | 'retry' | 'stop' | null
  hint?: string
}

const CONNECT_HINT = '启动后会连上已绑定的 QQ/飞书/微信'

/** 头部胶囊视图:按网关四态给文案/色调/动作。stopped/error 才带启动/重试与副作用提示。 */
export function gatewayPillView(status: GatewayStatus): GatewayPillView {
  switch (status.state) {
    case 'running':
      return { text: '网关运行中', tone: 'ok', action: 'stop' }
    case 'starting':
      return { text: '网关启动中…', tone: 'muted', action: 'stop' }
    case 'error':
      return {
        text: '网关异常' + (status.message ? ' · ' + status.message : ''),
        tone: 'err', action: 'retry', hint: CONNECT_HINT,
      }
    case 'stopped':
    default:
      return { text: '网关未运行', tone: 'warn', action: 'start', hint: CONNECT_HINT }
  }
}
