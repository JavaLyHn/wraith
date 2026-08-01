import type { GatewayBindPhase, GatewayState } from '../../shared/gateway'

/** 打码：保留首尾各 4 位,中间星号(≤8 位只留前 2)。 */
export function maskId(s: string | null): string {
  if (!s) return '—'
  if (s.length <= 8) return s.slice(0, 2) + '****'
  return s.slice(0, 4) + '****' + s.slice(-4)
}

/** 绑定阶段 → 可读提示。 */
export function bindPhaseLabel(phase: GatewayBindPhase, message?: string): string {
  switch (phase) {
    case 'scanning': return '等待扫码授权…'
    case 'bound': return '✅ 绑定成功'
    case 'secret-invalid': return message ?? 'openclaw 返回的密钥无法换取 token,请手填机器人密钥'
    case 'cancelled': return '已取消绑定'
    case 'failed': return message ?? '绑定失败,请重试'
  }
}

/** 四个已支持平台的短名(散文里用;IM_PLATFORMS 里的是目录全名如「飞书 / Lark」)。 */
export const IM_SHORT_LABEL: Record<string, string> = {
  qq: 'QQ', weixin: '微信', feishu: '飞书', wecom: '企业微信',
}

/**
 * 绑定成功后喂给 agent 的系统事件正文。
 * ⚠ 必须带上网关运行态:agent 拿到这条就会向用户宣布结果,若不告诉它网关没跑,
 * 它会顺嘴说成「可以发消息了」,而实际上发不出去。
 */
export function imBoundEventText(platform: string, state: GatewayState | null): string {
  const name = IM_SHORT_LABEL[platform] ?? platform
  const gw = state === 'running' ? '运行中'
    : state === 'starting' ? '正在启动'
    : state === 'stopped' ? '未运行(需用户启动网关后才能收发消息)'
    : state === 'error' ? '报错(需用户到 IM 网关面板查看日志)'
    : '未知'
  // 这段文字有两个读者:agent(据此答复)和用户(会作为「系统事件」气泡原样显示),
  // 所以要写成人话,不能塞只对模型说的指令腔。
  return `用户刚刚在聊天内完成了「${name}」的接入绑定。当前网关状态:${gw}。请据此向用户确认结果。`
}

/**
 * 绑定成功后的「还能不能用」提示。
 * ⚠ 绑定 ≠ 网关在跑:面板里 start/stop 是与绑定彼此独立的开关。只有 running 才敢说
 * 「可以发消息了」,否则就是骗用户 —— 这也是本函数存在的唯一理由。
 * state 为 null 表示运行态还没查回来。
 */
export function bindDoneHint(platformLabel: string, state: GatewayState | null): string {
  switch (state) {
    case 'running': return `现在可以直接在${platformLabel}里给我发消息了。`
    case 'starting': return '网关正在启动,稍等片刻即可开始对话。'
    case 'stopped': return '还差一步:网关未运行,启动后才能收发消息。'
    case 'error': return '网关当前报错,请到 IM 网关面板查看日志。'
    default: return '正在查询网关运行状态…'
  }
}

/**
 * 接入平台卡片的状态文案 —— 只看该平台自身是否可用/已配置,与「当前选中哪张卡」无关。
 * 之前的 bug 是拿 isSelected && bound 判断,导致只有被选中的卡才可能显示「已配置」。
 */
export function platformStatusText(status: string, configured: boolean): string {
  if (status !== 'available') return '即将支持'
  return configured ? '✓ 已配置' : '可配置'
}

/** 配套的文案颜色 class,同样只依赖该平台自身状态。 */
export function platformStatusColor(status: string, configured: boolean): string {
  return status === 'available' && configured ? 'text-ok' : 'text-fg-subtle'
}
