import type { GatewayState, GatewayStatus } from '../../shared/gateway'
import type { AutomationTask } from '../../shared/types'
import { computeNextRunLabel } from './automationLabels'

/**
 * 任务列表项副标签。
 *
 * ⚠ 只有网关 running 才给具体时刻。调度器活在 GatewayDaemon 里,网关没起 = 任务
 * 根本不会执行,此时报一个「下次 HH:mm」是纯粹的谎话 —— 真机上就是这样:任务
 * 停在「下次 16:17」,而它从创建起 35 分钟一次都没跑过,用户完全看不出问题在哪。
 */
export function nextRunSubLabel(task: AutomationTask, gatewayState: GatewayState, now?: number): string {
  if (!task.enabled) return '已暂停'
  if (gatewayState === 'starting') return '网关启动中…'
  if (gatewayState !== 'running') return '未排期 · 网关未运行'
  return computeNextRunLabel(task, now)
}

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
